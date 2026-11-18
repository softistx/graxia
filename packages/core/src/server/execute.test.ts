import { describe, expect, test } from 'bun:test';
import { parse } from 'graphql';
import type { TypedDocument } from '../document/typed';
import { GraxiaExecuteError } from '../errors/execute-error';
import * as entry from '../index';
import { definePlugin } from '../plugins/define';
import { createSchema } from '../schema/create-schema';
import { getContext } from './context';
import { createGraxia } from './create-graxia';

const schema = createSchema<Record<string, any>>()({
	typeDefs: `
		type Query { hello: String greet(name: String!): String boom: String who: String ctx: String wait: String }
		type Mutation { bump: Int }
		type Subscription { tick: Int }
	`,
	resolvers: {
		Query: {
			hello: () => 'world',
			greet: (_r, args) => `hi ${String(args['name'])}`,
			boom: () => {
				throw new Error('secret detail');
			},
			who: (_r, _a, ctx) => String(ctx['user']),
			ctx: (_r, _a, ctx) => String(getContext() === ctx),
			wait: (_r, _a, ctx) =>
				new Promise<string>((resolve) => {
					ctx['signal'].addEventListener('abort', () => resolve('aborted'));
					ctx['started']?.();
				}),
		},
		Mutation: { bump: () => 1 },
	},
});

const quiet = { onUnexpected: false } as const;

describe('graxia.execute', () => {
	test('runs a string document', async () => {
		const graxia = createGraxia({ schema, ...quiet });
		expect(await graxia.execute({ document: '{ hello }' })).toEqual({
			data: { hello: 'world' },
		});
	});

	test('runs a DocumentNode without parsing it, and a typed document', async () => {
		// A 1-token limit rejects the string, never a document that skips the parse.
		const graxia = createGraxia({ schema, ...quiet, limits: { tokens: 1 } });
		const refused = await graxia.execute({ document: '{ hello }' });
		expect(refused.errors?.[0]?.message).toContain('tokens');
		const document = parse('{ hello }') as TypedDocument<
			{ hello: string },
			Record<never, never>
		>;
		const result = await graxia.execute({ document });
		expect(result.data?.hello).toBe('world');
	});

	test('variables, operationName and mutations', async () => {
		const graxia = createGraxia({ schema, ...quiet });
		const greet = await graxia.execute({
			document:
				'query A($name: String!) { greet(name: $name) } query B { hello }',
			variables: { name: 'Ada' },
			operationName: 'A',
		});
		expect(greet.data).toEqual({ greet: 'hi Ada' });
		const bump = await graxia.execute({ document: 'mutation { bump }' });
		expect(bump.data).toEqual({ bump: 1 });
		const missing = await graxia.execute({
			document: 'query A { hello } query B { hello }',
		});
		expect(missing.errors?.[0]?.message).toContain('operation name');
	});

	test('parse and validation errors come back in the result', async () => {
		const graxia = createGraxia({ schema, ...quiet });
		const bad = await graxia.execute({ document: '{ hello' });
		expect(bad.errors?.[0]?.message).toContain('Syntax Error');
		const unknown = await graxia.execute({ document: '{ nope }' });
		expect(unknown.errors?.[0]?.message).toContain('nope');
	});

	test('hooks see the synthetic request; headers, context and getContext work', async () => {
		const seen: Request[] = [];
		const graxia = createGraxia<{ user: string }>({
			schema,
			...quiet,
			plugins: [
				definePlugin()({
					name: 'spy',
					onRequest: ({ request }) => {
						seen.push(request);
					},
				}),
			],
			context: ({ request }) => ({ tenant: request.headers.get('x-tenant') }),
		});
		const result = await graxia.execute({
			document: '{ who ctx }',
			headers: { 'x-tenant': 't1' },
			serverContext: { user: 'ada' },
		});
		expect(result.data).toEqual({ who: 'ada', ctx: 'true' });
		expect(seen).toHaveLength(1);
		expect(seen[0]?.method).toBe('POST');
		expect(new URL(seen[0]?.url ?? '').pathname).toBe('/graphql');
		expect(seen[0]?.headers.get('x-tenant')).toBe('t1');
	});

	test('masks unexpected errors', async () => {
		const graxia = createGraxia({ schema, ...quiet });
		const result = await graxia.execute({ document: '{ boom }' });
		expect(result.errors?.[0]?.message).toBe('Unexpected error.');
		expect(JSON.stringify(result)).not.toContain('secret detail');
	});

	test('a respond short-circuit rejects with GraxiaExecuteError', async () => {
		const graxia = createGraxia({
			schema,
			...quiet,
			plugins: [
				definePlugin()({
					name: 'gate',
					onRequest: ({ respond }: any) =>
						respond(new Response('no', { status: 401 })),
				}),
			],
		});
		const error = await graxia
			.execute({ document: '{ hello }' })
			.catch((e) => e);
		expect(error).toBeInstanceOf(GraxiaExecuteError);
		expect(error.status).toBe(401);
		expect(await error.response.text()).toBe('no');
	});

	test('subscriptions return the refusal in the result', async () => {
		const graxia = createGraxia({ schema, ...quiet });
		const result = await graxia.execute({ document: 'subscription { tick }' });
		expect(result.errors?.[0]?.extensions?.['code']).toBe(
			'SUBSCRIPTION_NOT_SUPPORTED',
		);
	});

	test('rejects after dispose', async () => {
		const graxia = createGraxia({ schema, ...quiet });
		await graxia.dispose();
		const error = await graxia
			.execute({ document: '{ hello }' })
			.catch((e) => e);
		expect(error).toBeInstanceOf(GraxiaExecuteError);
		expect(error.status).toBe(503);
		expect((await error.response.json()).errors[0].extensions.code).toBe(
			'SHUTTING_DOWN',
		);
	});

	test('signal aborts the operation', async () => {
		const controller = new AbortController();
		const graxia = createGraxia({
			schema,
			...quiet,
			context: () => ({
				started: () => queueMicrotask(() => controller.abort()),
			}),
		});
		const result = await graxia.execute({
			document: '{ wait }',
			signal: controller.signal,
		});
		expect(result.errors?.[0]?.extensions?.['code']).toBe('OPERATION_ABORTED');
	});

	test('the package entry exports GraxiaExecuteError', () => {
		expect(entry.GraxiaExecuteError).toBe(GraxiaExecuteError);
		const args: entry.ExecuteArgs<unknown, unknown, object> = {
			document: '{ hello }',
		};
		expect(args.document).toBe('{ hello }');
	});

	test('a query replaced by onParams runs on the DocumentNode path', async () => {
		const graxia = createGraxia({
			schema,
			...quiet,
			plugins: [
				definePlugin()({
					name: 'rewrite',
					onParams: ({ setParams }: any) => setParams({ query: '{ who }' }),
				}),
			],
			context: () => ({ user: 'ada' }),
		});
		const viaNode = await graxia.execute({ document: parse('{ hello }') });
		const viaString = await graxia.execute({ document: '{ hello }' });
		expect(viaNode.data).toEqual({ who: 'ada' });
		expect(viaString.data).toEqual(viaNode.data);
	});

	test('non-serializable variables throw a TypeError', async () => {
		const graxia = createGraxia({ schema, ...quiet });
		const error = await graxia
			.execute({ document: '{ hello }', variables: { n: 1n } })
			.catch((e) => e);
		expect(error).toBeInstanceOf(TypeError);
		expect(error.message).toContain('JSON-serializable');
	});

	test('an unexpected failure rejects with the original error as cause', async () => {
		const boom = new Error('hook failed');
		const graxia = createGraxia({
			schema,
			...quiet,
			plugins: [
				definePlugin()({
					name: 'bad',
					onRequest: () => {
						throw boom;
					},
				}),
			],
		});
		const error = await graxia
			.execute({ document: '{ hello }' })
			.catch((e) => e);
		expect(error).toBeInstanceOf(GraxiaExecuteError);
		expect(error.status).toBe(500);
		expect(error.cause).toBe(boom);
		expect(await error.response.text()).not.toContain('hook failed');
	});

	test('works with batching on', async () => {
		const graxia = createGraxia({ schema, ...quiet, batching: { limit: 3 } });
		const result = await graxia.execute({ document: '{ hello }' });
		expect(result.data).toEqual({ hello: 'world' });
	});

	test('the dispose rejection is a sealed response with a request id', async () => {
		const graxia = createGraxia({ schema, ...quiet });
		await graxia.dispose();
		const error = await graxia
			.execute({ document: '{ hello }' })
			.catch((e) => e);
		expect(error.message).toBe('Server is shutting down.');
		expect(error.response.headers.get('x-request-id')).toBeTruthy();
	});
});
