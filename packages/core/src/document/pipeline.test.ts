import { describe, expect, test } from 'bun:test';
import { buildSchema, GraphQLError, parse } from 'graphql';
import { createPluginEngine } from '../plugins/engine';
import { StateBag } from '../plugins/state';
import type { GraxiaPlugin } from '../plugins/types';
import { createDocumentPipeline } from './pipeline';
import type { DocumentCaches, DocumentLimits } from './types';

const schema = buildSchema('type Query { a: String b: String }');
const request = new Request('http://x/graphql');
const make = (
	plugins: GraxiaPlugin<any, any>[] = [],
	limits?: DocumentLimits,
	caches?: DocumentCaches,
) =>
	createDocumentPipeline({
		schema,
		engine: createPluginEngine(plugins),
		...(limits ? { limits } : {}),
		...(caches !== undefined ? { caches } : {}),
	});
const input = (source: string) => ({
	source,
	state: new StateBag(),
	request,
});
const vin = (source: string, document = parse(source)) => ({
	document,
	cacheKey: source,
	state: new StateBag(),
	request,
});

describe('limits', () => {
	test('tokens: at the boundary passes, over fails with limit and fix', async () => {
		const p = make([], { tokens: 5 });
		expect((await p.parse(input('{ a }'))).errors).toBeUndefined(); // { a } = 3 + <SOF>
		const over = await p.parse(input('{ a b c d e f }'));
		const err = over.errors?.[0] as GraphQLError;
		expect(err.extensions['code']).toBe('GRAPHQL_PARSE_FAILED');
		expect(err.extensions['limit']).toBe(5);
		expect(String(err.extensions['fix'])).toContain('limits.tokens');
	});

	test('nesting counts brackets, not strings, comments or block strings', async () => {
		const p = make([], { nesting: 3 });
		const noise = '{ a(x: "{{{{{{") } # {{{{{{\n';
		const block = '{ a(x: """ {{{{{{ \\""" ((( """) }';
		expect((await p.parse(input(noise))).errors).toBeUndefined();
		expect((await p.parse(input(block))).errors).toBeUndefined();
		const deep = await p.parse(input('{ a(x: [[[1]]]) }'));
		expect(deep.errors?.[0]?.extensions['limit']).toBe(3);
		expect(deep.errors?.[0]?.extensions['code']).toBe('GRAPHQL_PARSE_FAILED');
	});

	test('a parser stack overflow is a parse failure, not a crash', async () => {
		const p = make([], { nesting: false, tokens: false });
		const source = `${'['.repeat(200_000)}${']'.repeat(200_000)}`;
		const r = await p.parse(input(`{ a(x: ${source}) }`));
		expect(r.errors?.[0]?.extensions['code']).toBe('GRAPHQL_PARSE_FAILED');
	});

	test('a syntax error keeps its location and the code', async () => {
		const r = await make().parse(input('{ a '));
		expect(r.errors?.[0]?.extensions['code']).toBe('GRAPHQL_PARSE_FAILED');
		expect(r.errors?.[0]?.locations?.length).toBe(1);
	});
});

describe('parse cache', () => {
	test('hit returns the same DocumentNode; failures are cached', async () => {
		const p = make();
		const a = await p.parse(input('{ a }'));
		const b = await p.parse(input('{ a }'));
		expect(a.document).toBeDefined();
		expect(b.document).toBe(a.document as never);
		const f1 = await p.parse(input('{ a '));
		const f2 = await p.parse(input('{ a '));
		expect(f2.errors).toBe(f1.errors as never);
	});

	test('caches: false parses every time', async () => {
		const p = make([], undefined, false);
		const a = await p.parse(input('{ a }'));
		const b = await p.parse(input('{ a }'));
		expect(b.document).not.toBe(a.document as never);
	});

	test('a custom parse fn bypasses the cache', async () => {
		let calls = 0;
		const plugin: GraxiaPlugin = {
			name: 'p',
			onParse: ({ setParseFn }) =>
				setParseFn((s) => {
					calls++;
					return parse(s);
				}),
		};
		const p = make([plugin]);
		await p.parse(input('{ a }'));
		await p.parse(input('{ a }'));
		expect(calls).toBe(2);
	});

	test('setDocument skips parsing', async () => {
		const doc = parse('{ b }');
		const plugin: GraxiaPlugin = {
			name: 'p',
			onParse: ({ setDocument }) => setDocument(doc),
		};
		const r = await make([plugin]).parse(input('not graphql'));
		expect(r.document).toBe(doc);
	});

	test('runAfter receives the outcome; a throwing hook surfaces as error', async () => {
		let seen: unknown;
		const ok: GraxiaPlugin = {
			name: 'ok',
			onParse: () => (done) => {
				seen = done.document;
			},
		};
		const r = await make([ok]).parse(input('{ a }'));
		expect(seen).toBe(r.document as never);
		const boom = new Error('boom');
		const bad: GraxiaPlugin = {
			name: 'bad',
			onParse: () => {
				throw boom;
			},
		};
		const f = await make([bad]).parse(input('{ a }'));
		expect(f.error).toBe(boom);
	});
});

describe('validation', () => {
	test('returns the document or the errors, and caches by source', async () => {
		const p = make();
		expect((await p.validate(vin('{ a }'))).errors).toBeUndefined();
		const e1 = await p.validate(vin('{ zzz }'));
		const e2 = await p.validate(vin('{ zzz }'));
		expect(e1.errors?.length).toBe(1);
		expect(e2.errors).toBe(e1.errors as never);
	});

	test('two schemas do not share the cache', async () => {
		const other = buildSchema('type Query { zzz: String }');
		const engine = createPluginEngine([]);
		const a = createDocumentPipeline({ schema, engine });
		const b = createDocumentPipeline({ schema: other, engine });
		expect((await a.validate(vin('{ zzz }'))).errors?.length).toBe(1);
		expect((await b.validate(vin('{ zzz }'))).errors).toBeUndefined();
	});

	test('addRule takes effect and is not cached', async () => {
		const plugin: GraxiaPlugin = {
			name: 'r',
			onValidate: ({ addRule }) =>
				addRule((ctx) => ({
					Field(node) {
						if (node.name.value === 'b')
							ctx.reportError(new GraphQLError('b is forbidden'));
					},
				})),
		};
		const p = make([plugin]);
		const r = await p.validate(vin('{ b }'));
		expect(r.errors?.[0]?.message).toBe('b is forbidden');
		expect((await p.validate(vin('{ a }'))).errors).toBeUndefined();
	});

	test('setResult skips validation; runAfter gets the errors', async () => {
		const forced = [new GraphQLError('forced')];
		let seen: unknown;
		const plugin: GraxiaPlugin = {
			name: 's',
			onValidate: ({ setResult }) => {
				setResult(forced);
				return (done) => {
					seen = done.errors;
				};
			},
		};
		const r = await make([plugin]).validate(vin('{ a }'));
		expect(r.errors).toBe(forced);
		expect(seen).toBe(forced);
	});

	test('a document without source is not cached; a throwing hook is error', async () => {
		const p = make();
		const doc = parse('{ zzz }');
		const a = await p.validate({
			...vin('{ zzz }', doc),
			cacheKey: undefined,
		} as never);
		const b = await p.validate({
			...vin('{ zzz }', doc),
			cacheKey: undefined,
		} as never);
		expect(a.errors).not.toBe(b.errors as never);
		const boom = new Error('x');
		const bad: GraxiaPlugin = {
			name: 'bad',
			onValidate: () => {
				throw boom;
			},
		};
		expect((await make([bad]).validate(vin('{ a }'))).error).toBe(boom);
	});
});

describe('cache contracts', () => {
	test('parse returns cacheKey only for the default parse', async () => {
		expect((await make().parse(input('{ a }'))).cacheKey).toBe('{ a }');
		const p = make([
			{ name: 'p', onParse: ({ setParseFn }) => setParseFn((s) => parse(s)) },
		]);
		expect((await p.parse(input('{ a }'))).cacheKey).toBeUndefined();
	});

	test('a plugin parse fn returning another document neither reads nor poisons the cache', async () => {
		const swap: GraxiaPlugin = {
			name: 'swap',
			onParse: ({ setParseFn }) => setParseFn(() => parse('{ zzz }')),
		};
		const evil = make([swap]);
		const r = await evil.parse(input('{ a }'));
		const v = await evil.validate({
			...vin('{ a }', r.document),
			cacheKey: r.cacheKey,
		});
		expect(v.errors?.length).toBe(1);
		// same pipeline shape, default parse of the same source: still valid
		const plain = await make().validate(vin('{ a }'));
		expect(plain.errors).toBeUndefined();
	});

	test('a stack overflow failure is not cached', async () => {
		const p = make([], { nesting: false, tokens: false });
		const q = `{ a(x: ${'['.repeat(200_000)}${']'.repeat(200_000)}) }`;
		const a = await p.parse(input(q));
		const b = await p.parse(input(q));
		expect(a.errors?.[0]?.extensions['limit']).toBeUndefined();
		expect(String(a.errors?.[0]?.extensions['fix'])).toBeTruthy();
		expect(b.errors).not.toBe(a.errors as never);
	});

	test('a throwing runAfter surfaces as error', async () => {
		const boom = new Error('after');
		const p = make([
			{
				name: 'a',
				onParse: () => () => {
					throw boom;
				},
			},
		]);
		const r = await p.parse(input('{ a }'));
		expect(r.error).toBe(boom);
	});

	test('a hook error on a cached parse hit surfaces and keeps the cache', async () => {
		let fail = false;
		const boom = new Error('hook');
		const p = make([
			{
				name: 'h',
				onParse: () => {
					if (fail) throw boom;
				},
			},
		]);
		const first = await p.parse(input('{ a }'));
		fail = true;
		expect((await p.parse(input('{ a }'))).error).toBe(boom);
		fail = false;
		expect((await p.parse(input('{ a }'))).document).toBe(
			first.document as never,
		);
	});
});
