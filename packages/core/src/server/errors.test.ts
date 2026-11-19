import { describe, expect, test } from 'bun:test';
import { GraphQLError } from 'graphql';
import { exposedError, isGraxiaError } from '../errors/exposed';
import { INTERNAL_FIX, NON_NULL_FIX } from '../errors/fixes';
import { defaultMask, maskResult } from '../errors/mask';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from './create-graxia';

const schema = createSchema()({
	typeDefs: `
		type Query {
			plain: String
			str: String
			exposed: String
			gql: String
			nonNull: String!
			nullable: String
			forgedNonNull: String!
			hello(n: Int!): String
			list: [String]
		}
	`,
	resolvers: {
		Query: {
			plain: () => {
				throw new Error('secret detail');
			},
			str: () => {
				throw 'raw secret';
			},
			exposed: () => {
				throw exposedError('NOT_FOUND', 'Book not found.', {
					fix: 'Check the id.',
					extensions: { id: 7 },
				});
			},
			gql: () => {
				throw new GraphQLError('plain gql', { extensions: { code: 'X' } });
			},
			nonNull: () => null as never,
			nullable: () => {
				throw new Error(
					'Cannot return null for non-nullable field Query.nullable.',
				);
			},
			forgedNonNull: () => {
				throw new Error(
					'Cannot return null for non-nullable field Query.nope.',
				);
			},
			hello: () => 'hi',
			list: () => ['a'],
		},
	},
});

const post = (body: unknown) =>
	new Request('http://x/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});

type Seen = { error: unknown; info: unknown };
const make = (extra: object = {}) => {
	const seen: Seen[] = [];
	const graxia = createGraxia({
		schema,
		batching: { limit: 5 },
		onUnexpected: (error, info) => seen.push({ error, info }),
		...extra,
	});
	return { graxia, seen };
};
const run = async (
	graxia: ReturnType<typeof make>['graxia'],
	body: unknown,
) => {
	const res = await graxia.fetch(post(body));
	const text = await res.clone().text();
	expect(text).not.toContain('originalError');
	expect(text).not.toContain('stack');
	return { res, body: JSON.parse(text) };
};

describe('masking', () => {
	test('a plain Error is masked with path, locations and a correlation id', async () => {
		const { graxia, seen } = make();
		const { res, body } = await run(graxia, { query: '{ plain }' });
		const id = res.headers.get('x-request-id');
		expect(body.errors).toEqual([
			{
				message: 'Unexpected error.',
				path: ['plain'],
				locations: [{ line: 1, column: 3 }],
				extensions: {
					code: 'INTERNAL_SERVER_ERROR',
					fix: INTERNAL_FIX,
					correlationId: id,
				},
			},
		]);
		expect(JSON.stringify(body)).not.toContain('secret');
		expect(seen).toHaveLength(1);
		expect(seen[0]?.error).toHaveProperty('message', 'secret detail');
		expect(seen[0]?.info).toEqual({
			requestId: id,
			correlationId: id,
			phase: 'execution',
		});
	});
	test('a thrown string is masked', async () => {
		const { graxia, seen } = make();
		const { body } = await run(graxia, { query: '{ str }' });
		expect(body.errors[0].message).toBe('Unexpected error.');
		expect(seen).toHaveLength(1);
	});
	test('exposedError passes code, fix and extensions', async () => {
		const { graxia, seen } = make();
		const { body } = await run(graxia, { query: '{ exposed }' });
		expect(body.errors[0].message).toBe('Book not found.');
		expect(body.errors[0].extensions).toEqual({
			id: 7,
			code: 'NOT_FOUND',
			fix: 'Check the id.',
		});
		expect(seen).toHaveLength(0);
		expect(isGraxiaError(exposedError('CONFLICT', 'c'))).toBe(true);
	});
	test('a plain GraphQLError is exposed as is', async () => {
		const { graxia, seen } = make();
		const { body } = await run(graxia, { query: '{ gql }' });
		expect(body.errors[0].message).toBe('plain gql');
		expect(body.errors[0].extensions).toEqual({ code: 'X' });
		expect(seen).toHaveLength(0);
	});
	test("graphql's own errors are unchanged", async () => {
		const { graxia, seen } = make();
		const nonNull = await run(graxia, { query: '{ nonNull }' });
		expect(nonNull.body.errors[0].message).toContain('non-nullable field');
		const vars = await run(graxia, {
			query: 'query($n: Int!) { hello(n: $n) }',
			variables: { n: 'x' },
		});
		expect(vars.body.errors[0].message).toContain('$n');
		const invalid = await run(graxia, { query: '{ nope }' });
		expect(invalid.body.errors[0].message).toContain('nope');
		expect(seen).toHaveLength(0);
	});
	test('every batch entry is masked', async () => {
		const { graxia, seen } = make();
		const { res, body } = await run(graxia, [
			{ query: '{ plain }' },
			{ query: '{ hello(n: 1) }' },
			{ query: '{ str }' },
		]);
		const id = res.headers.get('x-request-id');
		expect(body[0].errors[0].extensions.correlationId).toBe(id);
		expect(body[1].data.hello).toBe('hi');
		expect(body[2].errors[0].message).toBe('Unexpected error.');
		expect(seen).toHaveLength(2);
	});
	test('a custom maskError replaces the default masker', async () => {
		const { graxia } = make({
			maskError: (
				error: GraphQLError,
				{ correlationId }: { correlationId?: string },
			) =>
				new GraphQLError('Oops', {
					path: error.path ?? [],
					extensions: { code: 'CUSTOM', ref: correlationId },
				}),
		});
		const { res, body } = await run(graxia, { query: '{ plain }' });
		expect(body.errors[0].message).toBe('Oops');
		expect(body.errors[0].extensions).toEqual({
			code: 'CUSTOM',
			ref: res.headers.get('x-request-id'),
		});
	});
	test('maskErrors: false exposes the message', async () => {
		const { graxia, seen } = make({ maskErrors: false });
		const { body } = await run(graxia, { query: '{ plain }' });
		expect(body.errors[0].message).toBe('secret detail');
		expect(seen).toHaveLength(0);
	});
});

describe('the generic 500', () => {
	test('carries the correlation id the hook also received', async () => {
		const { graxia, seen } = make({
			plugins: [
				{
					name: 'boom',
					onRequest: () => {
						throw new Error('hook');
					},
				},
			],
		});
		const res = await graxia.fetch(post({ query: '{ list }' }));
		const body = await res.json();
		const id = res.headers.get('x-request-id');
		expect(res.status).toBe(500);
		expect(body.errors[0]).toEqual({
			message: 'Unexpected error.',
			extensions: {
				code: 'INTERNAL_SERVER_ERROR',
				fix: INTERNAL_FIX,
				correlationId: id,
			},
		});
		expect(seen[0]?.info).toEqual({
			requestId: id,
			correlationId: id,
			phase: 'request',
		});
	});
});

describe('forged and inherited', () => {
	test('forged non-null texts are masked and reported', async () => {
		const { graxia, seen } = make();
		const a = await run(graxia, { query: '{ nullable }' });
		expect(a.body.errors[0].message).toBe('Unexpected error.');
		const b = await run(graxia, { query: '{ forgedNonNull }' });
		expect(b.body.errors[0].message).toBe('Unexpected error.');
		expect(seen).toHaveLength(2);
	});
	test('inherited extensions are dropped from an exposed error', () => {
		const message = 'Cannot return null for non-nullable field Query.nonNull.';
		const cause = Object.assign(new Error(message), {
			extensions: { secret: 1 },
		});
		const error = new GraphQLError(message, {
			originalError: cause,
			path: ['nonNull'],
		});
		expect(error.extensions).toBe(cause.extensions);
		const out = maskResult(
			{ errors: [error] },
			defaultMask,
			{ correlationId: 'i' },
			schema,
		);
		expect(out.unexpected).toHaveLength(0);
		expect(out.result.errors?.[0]?.extensions).toEqual({ fix: NON_NULL_FIX });
	});
});

describe('a throwing maskError', () => {
	const bad = {
		maskError: () => {
			throw new Error('masker broke');
		},
	};
	test('falls back to the default masker and reports both', async () => {
		const { graxia, seen } = make(bad);
		const { res, body } = await run(graxia, { query: '{ plain }' });
		expect(body.errors[0].extensions.correlationId).toBe(
			res.headers.get('x-request-id'),
		);
		expect(seen.map((x) => (x.error as Error).message)).toEqual([
			'secret detail',
			'masker broke',
		]);
		expect(
			seen.every((x) => (x.info as { phase: string }).phase === 'execution'),
		).toBe(true);
	});
	test('in a batch only the affected entry is degraded', async () => {
		const { graxia, seen } = make(bad);
		const { body } = await run(graxia, [
			{ query: '{ plain }' },
			{ query: '{ exposed }' },
		]);
		expect(body[0].errors[0].message).toBe('Unexpected error.');
		expect(body[1].errors[0].extensions.code).toBe('NOT_FOUND');
		expect(seen).toHaveLength(2);
	});
});
