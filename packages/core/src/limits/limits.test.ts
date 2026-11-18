import { describe, expect, test } from 'bun:test';
import { getIntrospectionQuery } from 'graphql';
import { GraxiaConfigError } from '../errors/config-error';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import type { GraxiaLimits } from '../server/options';
import { resolveOperationLimits } from './options';

const schema = createSchema()({
	typeDefs: `
		type Query { a: String b: String c: String n: Node }
		type Node { id: ID next: Node name: String }
	`,
	resolvers: { Query: { a: () => 'a', n: () => ({ id: '1' }) } },
});

async function run(query: string, limits: GraxiaLimits = {}) {
	const graxia = createGraxia({ schema, limits, onUnexpected: false });
	const response = await graxia.fetch(
		new Request('http://x/graphql', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/graphql-response+json',
			},
			body: JSON.stringify({ query }),
		}),
	);
	await graxia.dispose({ timeout: 10 });
	return { status: response.status, body: (await response.json()) as any };
}

const nest = (levels: number) =>
	`{ n ${'{ next '.repeat(levels - 1)}{ id }${' }'.repeat(levels - 1)} }`;

describe('depth', () => {
	test('passes at the limit', async () => {
		expect((await run(nest(3), { depth: 4 })).status).toBe(200);
	});
	test('refuses one over with the limit shape', async () => {
		const { status, body } = await run(nest(3), { depth: 3 });
		expect(status).toBe(400);
		expect(body.errors).toHaveLength(1);
		expect(body.errors[0].message).toBe(
			'Operation depth 4 exceeds the limit of 3.',
		);
		expect(body.errors[0].extensions).toEqual({
			code: 'GRAPHQL_VALIDATION_FAILED',
			limit: { name: 'depth', max: 3, actual: 4 },
			fix: 'Ask for fewer nested fields or raise limits.depth.',
		});
	});
	test('false turns it off', async () => {
		expect((await run(nest(30), { depth: false })).status).toBe(200);
	});
	test('counts through fragments and inline fragments', async () => {
		const query = `{ ...F } fragment F on Query { n { ... on Node { next { id } } } }`;
		expect((await run(query, { depth: 3 })).status).toBe(200);
		expect((await run(query, { depth: 2 })).status).toBe(400);
	});
	test('__typename counts nothing', async () => {
		expect((await run('{ __typename a }', { depth: 1 })).status).toBe(200);
	});
	test('the default limit lets the introspection query through', async () => {
		const { status, body } = await run(getIntrospectionQuery());
		expect(body.errors).toBeUndefined();
		expect(status).toBe(200);
	});
});

describe('aliases', () => {
	const query = '{ x: a y: b z: c }';
	test('at the limit passes, one over fails', async () => {
		expect((await run(query, { aliases: 3 })).status).toBe(200);
		const { status, body } = await run(query, { aliases: 2 });
		expect(status).toBe(400);
		expect(body.errors[0].extensions.limit).toEqual({
			name: 'aliases',
			max: 2,
			actual: 3,
		});
	});
	test('a fragment spread twice counts twice', async () => {
		const q = '{ ...F ...F } fragment F on Query { x: a }';
		expect((await run(q, { aliases: 2 })).status).toBe(200);
		expect((await run(q, { aliases: 1 })).status).toBe(400);
	});
	test('false turns it off', async () => {
		expect((await run(query, { aliases: false })).status).toBe(200);
	});
});

describe('directives', () => {
	const query =
		'{ a @skip(if: false) b @include(if: true) c @skip(if: false) }';
	test('at the limit passes, one over fails', async () => {
		expect((await run(query, { directives: 3 })).status).toBe(200);
		const { body } = await run(query, { directives: 2 });
		expect(body.errors[0].extensions.limit).toEqual({
			name: 'directives',
			max: 2,
			actual: 3,
		});
	});
	test('counts directives on fragments and spreads', async () => {
		const q = '{ ...F @include(if: true) } fragment F on Query @foo { a }';
		const refused = await run(q, { directives: 1 });
		expect(
			refused.body.errors.some(
				(e: any) => e.extensions.limit?.name === 'directives',
			),
		).toBe(true);
	});
	test('false turns it off', async () => {
		expect((await run(query, { directives: false })).status).toBe(200);
	});
});

describe('rootFields', () => {
	const query = '{ a b c }';
	test('at the limit passes, one over fails', async () => {
		expect((await run(query, { rootFields: 3 })).status).toBe(200);
		const { body } = await run(query, { rootFields: 2 });
		expect(body.errors[0].extensions.limit).toEqual({
			name: 'rootFields',
			max: 2,
			actual: 3,
		});
	});
	test('expands fragments and ignores __typename', async () => {
		const q =
			'{ __typename ...F ... on Query { c } } fragment F on Query { a b }';
		expect((await run(q, { rootFields: 3 })).status).toBe(200);
		expect((await run(q, { rootFields: 2 })).status).toBe(400);
	});
	test('false turns it off', async () => {
		expect((await run(query, { rootFields: false })).status).toBe(200);
	});
});

describe('introspection roots', () => {
	const roots = (n: number) =>
		`{ ${Array.from({ length: n }, (_, i) => `a${i}: __schema { queryType { name } }`).join(' ')} }`;
	test('aliased roots are refused on aliases and rootFields', async () => {
		const { body } = await run(roots(40));
		expect(body.errors.map((e: any) => e.extensions.limit.name).sort()).toEqual(
			['aliases', 'rootFields'],
		);
	});
	test('and on cost', async () => {
		const { body } = await run(roots(5), { cost: { max: 4 } });
		expect(body.errors[0].extensions.limit).toEqual({
			name: 'cost',
			max: 4,
			actual: 5,
		});
	});
	test('a deep introspection subtree adds no depth', async () => {
		const { status } = await run(
			'{ __type(name: "Query") { fields { type { ofType { ofType { ofType { ofType { name } } } } } } } }',
			{ depth: 1 },
		);
		expect(status).toBe(200);
	});
});

describe('several limits at once', () => {
	test('one error per limit exceeded', async () => {
		const { body } = await run('{ x: a y: b z: c }', {
			aliases: 1,
			rootFields: 1,
		});
		expect(body.errors.map((e: any) => e.extensions.limit.name).sort()).toEqual(
			['aliases', 'rootFields'],
		);
	});
});

describe('fragments', () => {
	test('a cycle does not hang the walk', async () => {
		const { status } = await run(
			'{ ...A } fragment A on Query { n { ...B } } fragment B on Node { next { ...B } }',
		);
		expect(status).toBe(400);
	});
	test('fragments spreading the previous one twice stay linear', async () => {
		const depth = 60;
		let query = '{ ...F0 }\nfragment F0 on Query { a }\n';
		for (let i = 1; i < depth; i++)
			query += `fragment F${i} on Query { ...F${i - 1} ...F${i - 1} }\n`;
		query = query.replace('{ ...F0 }', `{ ...F${depth - 1} }`);
		const started = performance.now();
		const { status } = await run(query, {
			aliases: 5,
			directives: 5,
			rootFields: false,
		});
		expect(status).toBe(200);
		expect(performance.now() - started).toBeLessThan(1000);
	});
});

describe('config errors', () => {
	test.each([
		[{ depth: 0 }, 'limits.depth must be a positive integer (or false)'],
		[{ aliases: 1.5 }, 'limits.aliases must be a positive integer (or false)'],
		[
			{ directives: -1 },
			'limits.directives must be a positive integer (or false)',
		],
		[
			{ rootFields: 0 },
			'limits.rootFields must be a positive integer (or false)',
		],
		[{ cost: { max: 0 } }, 'limits.cost.max must be a positive integer'],
		[
			{ cost: { defaultListSize: 0 } },
			'limits.cost.defaultListSize must be a positive integer',
		],
		[
			{ cost: { objectCost: -1 } },
			'limits.cost.objectCost must be a non-negative integer',
		],
		[
			{ cost: { scalarCost: 0.5 } },
			'limits.cost.scalarCost must be a non-negative integer',
		],
	] as const)('%j', (limits, message) => {
		expect(() =>
			createGraxia({ schema, limits: limits as GraxiaLimits }),
		).toThrow(new GraxiaConfigError(message));
	});

	test('defaults are on', () => {
		expect(resolveOperationLimits()).toMatchObject({
			depth: 12,
			aliases: 30,
			directives: 50,
			rootFields: 20,
			cost: { max: 5000, defaultListSize: 10, objectCost: 1, scalarCost: 0 },
		});
	});
});
