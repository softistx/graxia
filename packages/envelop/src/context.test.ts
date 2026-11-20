import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createSchema } from '@graxia/core';
import { GraphQLError } from 'graphql';
import { type Booted, boot, calls, typeDefs } from './fixtures.test-util';
import { fromEnvelop } from './from-envelop';

let app: Booted;
beforeEach(() => calls.reset());
afterEach(() => app.stop());

const seen: Record<string, unknown> = {};
const schema = createSchema()({
	typeDefs,
	resolvers: {
		Query: {
			hello: (_p: unknown, _a: unknown, ctx: any) => {
				calls.hello++;
				Object.assign(seen, ctx);
				return String(ctx.fromEnveloped ?? ctx.fromBuilding ?? 'none');
			},
		},
	},
});
const run = (hooks: object[], query = '{ hello }') => {
	app = boot([fromEnvelop(hooks as never)], { schema });
	return app.gql(query);
};

describe('context', () => {
	test('extendContext of onEnveloped reaches the resolver', async () => {
		const answer = await run([
			{
				onEnveloped: ({ extendContext }: any) =>
					extendContext({ fromEnveloped: 'e' }),
			},
		]);
		expect(answer.json.data.hello).toBe('e');
	});

	test('extendContext of onContextBuilding reaches the resolver and the after-hook sees it merged', async () => {
		let merged: any;
		const answer = await run([
			{
				onContextBuilding: ({ extendContext }: any) => {
					extendContext({ fromBuilding: 'b' });
					return ({ context }: any) => {
						merged = context;
					};
				},
			},
		]);
		expect(answer.json.data.hello).toBe('b');
		expect(merged.fromBuilding).toBe('b');
		expect(merged.request).toBeInstanceOf(Request);
	});

	test('breakContextBuilding stops the later plugins', async () => {
		const order: string[] = [];
		await run([
			{
				onContextBuilding: ({ breakContextBuilding }: any) => {
					order.push('a');
					breakContextBuilding();
				},
			},
			{ onContextBuilding: () => void order.push('b') },
		]);
		expect(order).toEqual(['a']);
	});

	test('a GraphQLError thrown while building answers with errors and runs no resolver', async () => {
		const answer = await run([
			{
				onContextBuilding: () => {
					throw new GraphQLError('denied', { extensions: { code: 'DENIED' } });
				},
			},
		]);
		expect(answer.json.errors[0].message).toBe('denied');
		expect(answer.json.errors[0].extensions.code).toBe('DENIED');
		expect(calls.hello).toBe(0);
	});

	test('a plain error is a masked 500 and registerContextErrorHandler can setError', async () => {
		let handled: unknown;
		const answer = await run([
			{
				onPluginInit: ({ registerContextErrorHandler }: any) =>
					registerContextErrorHandler(({ error }: any) => {
						handled = error;
					}),
				onContextBuilding: () => {
					throw new Error('db down');
				},
			},
		]);
		expect(answer.status).toBe(500);
		expect(answer.text).not.toContain('db down');
		expect((handled as Error).message).toBe('db down');
	});

	test('each batch entry gets its own context', async () => {
		let n = 0;
		app = boot(
			[
				fromEnvelop([
					{
						onContextBuilding: ({ extendContext }: any) =>
							extendContext({ fromBuilding: `n${++n}` }),
					} as never,
				]),
			],
			{ schema, batching: { limit: 5 } } as never,
		);
		const response = await fetch(app.url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify([{ query: '{ hello }' }, { query: '{ hello }' }]),
		});
		const body: any[] = await response.json();
		expect(body.map((b) => b.data.hello).sort()).toEqual(['n1', 'n2']);
	});
});
