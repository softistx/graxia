import { describe, expect, test } from 'bun:test';
import { buildSchema, GraphQLError, parse } from 'graphql';
import { GraxiaConfigError } from '../errors/config-error';
import { GraxiaPluginError } from '../errors/plugin-error';
import { definePlugin } from './define';
import { createPluginEngine } from './engine';
import { StateBag } from './state';
import type { GraxiaPlugin } from './types';

const base = () => ({
	request: new Request('http://localhost/graphql'),
	state: new StateBag(),
});
const plain = definePlugin();

test('direct and curried definePlugin return the plugin itself', () => {
	const spec = { name: 'same', onContext: () => ({ a: 1 }) };
	expect(definePlugin(spec)).toBe(spec);
	expect(definePlugin<{ request: Request }>()(spec)).toBe(spec);
});

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
		const { error } = await engine.runners.onContext({
			...base(),
			context: {},
		});
		expect(error).toBeInstanceOf(GraxiaConfigError);
		expect((error as Error).message).toMatch(/"bad"/);
	});
});

describe('errors, fast path, setup', () => {
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

describe('hook errors', () => {
	test('the runner does not reject: earlier after-hooks unwind, later hooks are skipped', async () => {
		const boom = new Error('boom');
		const log: string[] = [];
		const mk = (name: string, fail = false) =>
			plain({
				name,
				onRequest: () => {
					if (fail) throw boom;
					log.push(`${name}:before`);
					return () => void log.push(`${name}:after`);
				},
			});
		const engine = createPluginEngine([
			mk('a'),
			mk('b'),
			mk('c', true),
			mk('d'),
		]);
		const outcome = await engine.runners.onRequest(base());
		expect(outcome.error).toBe(boom);
		await outcome.runAfter({ response: undefined });
		expect(log).toEqual(['a:before', 'b:before', 'b:after', 'a:after']);
	});

	test('an async hook rejection is reported the same way', async () => {
		const boom = new Error('async boom');
		const engine = createPluginEngine([
			plain({ name: 't', onParse: async () => Promise.reject(boom) }),
		]);
		expect(
			(await engine.runners.onParse({ ...base(), params: {} })).error,
		).toBe(boom);
	});

	test('no error key when all hooks pass', async () => {
		const engine = createPluginEngine([
			plain({ name: 't', onRequest: () => {} }),
		]);
		expect('error' in (await engine.runners.onRequest(base()))).toBe(false);
	});
});

describe('setters do not stop the stage', () => {
	test('last write wins across plugins for document, result and parse fn', async () => {
		const d1 = parse('{ a }');
		const d2 = parse('{ b }');
		const f1 = () => d1;
		const f2 = () => d2;
		const engine = createPluginEngine([
			plain({
				name: 'a',
				onParse: (p) => {
					p.setDocument(d1);
					p.setParseFn(f1);
				},
				onValidate: (p) => p.setResult([]),
			}),
			plain({
				name: 'b',
				onParse: (p) => {
					p.setDocument(d2);
					p.setParseFn(f2);
				},
				onValidate: (p) => p.setResult([new GraphQLError('x')]),
			}),
		]);
		const parsed = (await engine.runners.onParse({ ...base(), params: {} }))
			.out;
		expect(parsed.document).toBe(d2);
		expect(parsed.parseFn).toBe(f2);
		const validated = await engine.runners.onValidate({
			...base(),
			schema: {} as never,
			document: d1,
		});
		expect(validated.out.errors).toHaveLength(1);
	});

	test('addRule accumulates across plugins', async () => {
		const r1 = () => ({});
		const r2 = () => ({});
		const engine = createPluginEngine([
			plain({ name: 'a', onValidate: (p) => p.addRule(r1) }),
			plain({ name: 'b', onValidate: (p) => p.addRule(r2) }),
		]);
		const { out } = await engine.runners.onValidate({
			...base(),
			schema: {} as never,
			document: parse('{ a }'),
		});
		expect(out.rules).toEqual([r1, r2]);
	});
});

describe('more stages', () => {
	test('onParams respond() short-circuits', async () => {
		const log: string[] = [];
		const engine = createPluginEngine([
			plain({
				name: 'a',
				onParams: ({ respond }) => respond(new Response('no', { status: 400 })),
			}),
			plain({ name: 'b', onParams: () => void log.push('b') }),
		]);
		const { out } = await engine.runners.onParams({ ...base(), params: {} });
		expect(out.response?.status).toBe(400);
		expect(log).toEqual([]);
	});

	test('onSubscribe has its own runner', async () => {
		const engine = createPluginEngine([
			plain({
				name: 's',
				onSubscribe: ({ setResult }) => setResult({ data: { s: 1 } }),
			}),
			plain({
				name: 'e',
				onExecute: ({ setResult }) => setResult({ data: { e: 1 } }),
			}),
		]);
		const { out } = await engine.runners.onSubscribe({
			...base(),
			args: {} as never,
		});
		expect(out.result).toEqual({ data: { s: 1 } });
		expect(engine.has('onSubscribe')).toBe(true);
	});

	test('async after-hooks are awaited in reverse order', async () => {
		const log: string[] = [];
		const mk = (name: string, ms: number) =>
			plain({
				name,
				onRequest: () => async () => {
					await Bun.sleep(ms);
					log.push(name);
				},
			});
		const outcome = await createPluginEngine([
			mk('a', 15),
			mk('b', 1),
		]).runners.onRequest(base());
		await outcome.runAfter({ response: undefined });
		expect(log).toEqual(['b', 'a']);
	});

	test('a promise resolving to an after-hook registers it', async () => {
		const log: string[] = [];
		const engine = createPluginEngine([
			plain({
				name: 'a',
				onRequest: async () => {
					await Bun.sleep(1);
					return () => void log.push('after');
				},
			}),
		]);
		const outcome = await engine.runners.onRequest(base());
		await outcome.runAfter({ response: undefined });
		expect(log).toEqual(['after']);
	});

	test('onContext rejects null and arrays', async () => {
		for (const [value, word] of [
			[null, 'null'],
			[[1], 'array'],
		] as const) {
			const bad = {
				name: 'bad',
				onContext: () => value,
			} as unknown as GraxiaPlugin;
			const { error } = await createPluginEngine([bad]).runners.onContext({
				...base(),
				context: {},
			});
			expect(error).toBeInstanceOf(GraxiaConfigError);
			expect((error as Error).message).toContain(`got ${word}`);
		}
	});
});

describe('after-hook failures', () => {
	test('a throwing after-hook does not stop the unwinding; the first error is reported', async () => {
		const log: string[] = [];
		const mk = (name: string, fail: boolean) =>
			plain({
				name,
				onRequest: () => () => {
					log.push(name);
					if (fail) throw new Error(`${name} failed`);
				},
			});
		const engine = createPluginEngine([
			mk('a', true),
			mk('b', true),
			mk('c', false),
		]);
		const outcome = await engine.runners.onRequest(base());
		await expect(outcome.runAfter({ response: undefined })).rejects.toThrow(
			'b failed',
		);
		expect(log).toEqual(['c', 'b', 'a']);
	});
	test('payloads carry the state responseHeaders', async () => {
		const seen: Headers[] = [];
		const engine = createPluginEngine([
			plain({
				name: 'h',
				onRequest: ({ responseHeaders }) => void seen.push(responseHeaders),
			}),
		]);
		const input = base();
		await engine.runners.onRequest(input);
		expect(seen[0]).toBe(input.state.responseHeaders);
	});
});

describe('setup schema and executeFn', () => {
	test('setup receives the instance schema', async () => {
		const schema = buildSchema('type Query { a: String }');
		let seen: unknown;
		const engine = createPluginEngine(
			[
				plain({
					name: 's',
					setup: (api) => {
						seen = api.schema;
					},
				}),
			],
			undefined,
			schema,
		);
		await engine.init();
		expect(seen).toBe(schema);
	});

	test('executeFn is the fallback, then the last one set', async () => {
		const seen: unknown[] = [];
		const fallback = async () => ({ data: { fallback: true } });
		const wrapped = async () => ({ data: { wrapped: true } });
		const engine = createPluginEngine([
			plain({
				name: 'a',
				onExecute: ({ executeFn, setExecuteFn }) => {
					seen.push(executeFn);
					setExecuteFn(wrapped);
				},
			}),
			plain({
				name: 'b',
				onExecute: ({ executeFn }) => void seen.push(executeFn),
			}),
		]);
		const outcome = await engine.runners.onExecute({
			...base(),
			args: {} as never,
			fallback,
		});
		expect(await (seen[0] as () => unknown)()).toEqual({
			data: { fallback: true },
		});
		expect(seen[1]).toBe(wrapped);
		expect(outcome.out.executeFn).toBe(wrapped);
	});
});

describe('a stage without hooks', () => {
	test('its outcome is not a promise and its runAfter resolves', async () => {
		const engine = createPluginEngine([]);
		const outcome = engine.runners.onRequest(base());
		expect(outcome instanceof Promise).toBe(false);
		const { runAfter } = outcome as Awaited<typeof outcome>;
		expect(await runAfter({ response: new Response() })).toBeUndefined();
	});
	test('a stage with hooks but no after-hook shares the resolved runAfter', async () => {
		const engine = createPluginEngine([
			plain({ name: 'p', onRequest: () => {} }),
		]);
		const empty = createPluginEngine([]);
		const outcome = await engine.runners.onRequest(base());
		const none = await empty.runners.onRequest(base());
		expect(outcome.runAfter).toBe(none.runAfter);
		await outcome.runAfter({ response: new Response() });
	});
	test('a zero-hook outcome carries no error for a well-formed input', async () => {
		// The zero-hook runner calls `spec.init` only: it cannot throw for a well-formed input.
		const engine = createPluginEngine([]);
		const outcome = await engine.runners.onResponse({
			...base(),
			response: new Response(),
		});
		expect(outcome.error).toBeUndefined();
	});
});
