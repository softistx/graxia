import { describe, expect, test } from 'bun:test';
import { parse } from 'graphql';
import { GraxiaConfigError } from '../errors/config-error';
import { GraxiaPluginError } from '../errors/plugin-error';
import { definePlugin } from './define';
import { createPluginEngine } from './engine';
import { RequestState } from './state';
import type { GraxiaPlugin } from './types';

const base = () => ({
	request: new Request('http://localhost/graphql'),
	state: new RequestState(),
});
const plain = definePlugin();

describe('ordering and onion', () => {
	test('before-hooks in order, after-hooks reversed', async () => {
		const log: string[] = [];
		const mk = (name: string, enforce?: 'pre' | 'post') =>
			plain({
				name,
				enforce,
				onRequest: () => {
					log.push(`${name}:before`);
					return () => {
						log.push(`${name}:after`);
					};
				},
			});
		const engine = createPluginEngine([
			mk('a', 'post'),
			mk('b'),
			mk('c', 'pre'),
		]);
		const outcome = await engine.runners.onRequest(base());
		await outcome.runAfter({ response: undefined });
		expect(log).toEqual([
			'c:before',
			'b:before',
			'a:before',
			'a:after',
			'b:after',
			'c:after',
		]);
	});

	test('async and sync hooks mix sequentially', async () => {
		const log: string[] = [];
		const engine = createPluginEngine([
			plain({
				name: 'slow',
				onParse: async () => {
					await Bun.sleep(5);
					log.push('slow');
				},
			}),
			plain({ name: 'fast', onParse: () => void log.push('fast') }),
		]);
		await engine.runners.onParse({ ...base(), params: {} });
		expect(log).toEqual(['slow', 'fast']);
	});
});

describe('short-circuit', () => {
	test('onRequest respond skips later hooks, earlier after-hooks still run', async () => {
		const log: string[] = [];
		const engine = createPluginEngine([
			plain({
				name: 'first',
				onRequest: () => {
					log.push('first');
					return ({ response }) => void log.push(`after:${response?.status}`);
				},
			}),
			plain({
				name: 'gate',
				onRequest: ({ respond }) =>
					respond(new Response(null, { status: 401 })),
			}),
			plain({ name: 'never', onRequest: () => void log.push('never') }),
		]);
		const outcome = await engine.runners.onRequest(base());
		expect(outcome.out.response?.status).toBe(401);
		await outcome.runAfter({ response: outcome.out.response });
		expect(log).toEqual(['first', 'after:401']);
	});

	test('setParams replaces params for later hooks', async () => {
		const seen: unknown[] = [];
		const engine = createPluginEngine([
			plain({
				name: 'a',
				onParams: ({ setParams }) => setParams({ query: '{ b }' }),
			}),
			plain({
				name: 'b',
				onParams: ({ params }) => void seen.push(params.query),
			}),
		]);
		const outcome = await engine.runners.onParams({
			...base(),
			params: { query: '{ a }' },
		});
		expect(seen).toEqual(['{ b }']);
		expect(outcome.out.params.query).toBe('{ b }');
	});

	test('setDocument, setResult and setExecuteFn land in the outcome', async () => {
		const doc = parse('{ a }');
		const fn = () => ({ data: null });
		const engine = createPluginEngine([
			plain({
				name: 'x',
				onParse: ({ setDocument }) => setDocument(doc),
				onValidate: ({ setResult, addRule }) => {
					setResult([]);
					addRule(() => ({}));
				},
				onExecute: ({ setExecuteFn, setResult }) => {
					setExecuteFn(fn);
					setResult({ data: { ok: true } });
				},
			}),
		]);
		expect(
			(await engine.runners.onParse({ ...base(), params: {} })).out.document,
		).toBe(doc);
		const v = (
			await engine.runners.onValidate({
				...base(),
				schema: {} as never,
				document: doc,
			})
		).out;
		expect(v.errors).toEqual([]);
		expect(v.rules).toHaveLength(1);
		const e = (await engine.runners.onExecute({ ...base(), args: {} as never }))
			.out;
		expect(e.executeFn).toBe(fn);
		expect(e.result).toEqual({ data: { ok: true } });
	});

	test('execute after-hook can replace the result', async () => {
		const engine = createPluginEngine([
			plain({
				name: 'x',
				onExecute:
					() =>
					({ setResult }) =>
						setResult({ data: { n: 2 } }),
			}),
		]);
		const outcome = await engine.runners.onExecute({
			...base(),
			args: {} as never,
		});
		let replaced: unknown;
		await outcome.runAfter({
			result: undefined,
			setResult: (r) => (replaced = r),
		});
		expect(replaced).toEqual({ data: { n: 2 } });
	});

	test('chunk and response can be replaced', async () => {
		const engine = createPluginEngine([
			plain({
				name: 'x',
				onResultChunk: ({ setChunk }) => setChunk('b'),
				onResponse: ({ setResponse }) => setResponse(new Response('new')),
			}),
		]);
		expect(
			(await engine.runners.onResultChunk({ ...base(), chunk: 'a' })).out.chunk,
		).toBe('b');
		const r = await engine.runners.onResponse({
			...base(),
			response: new Response('old'),
		});
		expect(await r.out.response.text()).toBe('new');
	});
});

describe('onContext', () => {
	test('merges in order, later wins, host context kept', async () => {
		const engine = createPluginEngine([
			plain({ name: 'a', onContext: () => ({ x: 1, y: 1 }) }),
			plain({
				name: 'b',
				onContext: async ({ context }) => ({
					y: 2,
					seen: (context as { x: number }).x,
				}),
			}),
			plain({ name: 'c', onContext: () => {} }),
		]);
		const { out } = await engine.runners.onContext({
			...base(),
			context: { host: true },
		});
		expect(out.context).toEqual({ host: true, x: 1, y: 2, seen: 1 });
	});

	test('a non-object return throws a config error naming the plugin', async () => {
		const bad = { name: 'bad', onContext: () => 5 } as unknown as GraxiaPlugin;
		const engine = createPluginEngine([bad]);
		const run = engine.runners.onContext({ ...base(), context: {} });
		await expect(run).rejects.toBeInstanceOf(GraxiaConfigError);
		await expect(run).rejects.toThrow(/"bad"/);
	});
});

describe('errors, fast path, setup', () => {
	test('a throwing hook rejects with the original error', async () => {
		const boom = new Error('boom');
		const engine = createPluginEngine([
			plain({
				name: 't',
				onRequest: () => {
					throw boom;
				},
			}),
		]);
		await expect(engine.runners.onRequest(base())).rejects.toBe(boom);
	});

	test('has() and the no-hook fast path', async () => {
		const engine = createPluginEngine([
			plain({ name: 'a', onRequest: () => {} }),
		]);
		expect(engine.has('onRequest')).toBe(true);
		expect(engine.has('onExecute')).toBe(false);
		const outcome = await engine.runners.onExecute({
			...base(),
			args: {} as never,
		});
		expect(outcome.out).toEqual({});
		await outcome.runAfter({ result: undefined, setResult: () => {} });
	});

	test('setup runs once, awaited, in order', async () => {
		const log: string[] = [];
		const engine = createPluginEngine([
			plain({
				name: 'a',
				setup: async ({ plugins }) => {
					await Bun.sleep(5);
					log.push(`a:${plugins.join(',')}`);
				},
			}),
			plain({ name: 'b', setup: () => void log.push('b') }),
		]);
		await Promise.all([engine.init(), engine.init()]);
		await engine.init();
		expect(log).toEqual(['a:a,b', 'b']);
	});

	test('a setup error names the plugin and keeps the cause', async () => {
		const cause = new Error('no db');
		const engine = createPluginEngine([
			plain({
				name: 'db',
				setup: () => {
					throw cause;
				},
			}),
		]);
		const error = await engine.init().catch((e) => e);
		expect(error).toBeInstanceOf(GraxiaPluginError);
		expect(error.plugin).toBe('db');
		expect(error.message).toContain('"db"');
		expect(error.cause).toBe(cause);
	});
});
