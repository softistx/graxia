import { describe, expect, test } from 'bun:test';
import { fieldRateLimit } from '../rate-limit/plugin';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import { INTERNAL_FIX, NON_NULL_FIX } from './fixes';

/**
 * Every error graxia emits carries `extensions.fix`, in development and in
 * production. One row per code path; a new path gets a row. (The WebSocket
 * upgrade refusals go through the same `refusal()` as HTTP, which takes `fix`
 * as a required argument, and `failure()` and trusted-document `refuse()` are
 * typed the same way.)
 */
const schema = createSchema()({
	typeDefs: `
		type Query { hello: String boom: String must: String! signIn: Boolean n(x: Int!): Int }
		type Mutation { bump: Int }
		type Subscription { tick: Int }
	`,
	resolvers: {
		Query: {
			hello: () => 'world',
			boom: () => {
				throw new Error('secret detail');
			},
			must: () => null as unknown as string,
			signIn: () => true,
		},
		Mutation: { bump: () => 1 },
	},
});

const json = 'application/json';
const call = (init: {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	path?: string;
	query?: string;
}) =>
	new Request(`http://localhost${init.path ?? '/graphql'}${init.query ?? ''}`, {
		method: init.method ?? 'POST',
		headers: { 'content-type': json, accept: json, ...init.headers },
		...(init.body !== undefined ? { body: init.body } : {}),
	});
const post = (body: unknown, headers: Record<string, string> = {}) =>
	call({ body: JSON.stringify(body), headers });
const get = (query: string) =>
	call({
		method: 'GET',
		query,
		headers: { 'x-graphql-csrf': '1' },
	});

interface Row {
	name: string;
	/** `extensions.code` expected, when the error has one. */
	code?: string;
	/** The exact `fix`, for the errors whose text graxia owns. */
	fix?: string;
	options?: Parameters<typeof createGraxia>[0] extends infer O
		? Partial<O>
		: never;
	request: () => Request;
	/** Run after the instance is built (a shutdown). */
	before?: (graxia: ReturnType<typeof createGraxia>) => Promise<unknown>;
}

const rows: Row[] = [
	{
		name: 'a syntax error',
		code: 'GRAPHQL_PARSE_FAILED',
		request: () => post({ query: '{ hello' }),
	},
	{
		name: 'a document too deeply nested',
		code: 'GRAPHQL_PARSE_FAILED',
		options: { limits: { tokens: 3 } } as never,
		request: () => post({ query: '{ hello boom must signIn }' }),
	},
	{
		name: 'a validation rule (unknown field)',
		code: 'GRAPHQL_VALIDATION_FAILED',
		request: () => post({ query: '{ nope }' }),
	},
	{
		name: 'a missing variable (coercion)',
		request: () => post({ query: 'query($x: Int!) { n(x: $x) }' }),
	},
	{
		name: 'an unknown operation name',
		request: () => post({ query: '{ hello }', operationName: 'Nope' }),
	},
	{
		name: 'a body without a query',
		request: () => post({}),
	},
	{
		name: 'a mutation over GET',
		request: () => get('?query=mutation{bump}'),
	},
	{
		name: 'introspection in production',
		code: 'GRAPHQL_VALIDATION_FAILED',
		options: { introspection: false } as never,
		request: () => post({ query: '{ __schema { types { name } } }' }),
	},
	{
		name: 'an operation over a limit',
		code: 'GRAPHQL_VALIDATION_FAILED',
		options: { limits: { aliases: 1 } } as never,
		request: () => post({ query: '{ a: hello b: hello }' }),
	},
	{
		name: 'a subscription over plain HTTP',
		code: 'SUBSCRIPTION_NOT_SUPPORTED',
		request: () => post({ query: 'subscription { tick }' }),
	},
	{
		name: '@defer over plain HTTP',
		code: 'INCREMENTAL_NOT_SUPPORTED',
		request: () => post({ query: '{ ... @defer { hello } }' }),
	},
	{
		name: 'a resolver that throws (masked)',
		code: 'INTERNAL_SERVER_ERROR',
		fix: INTERNAL_FIX,
		request: () => post({ query: '{ boom }' }),
	},
	{
		name: 'a non-null field that returns null',
		fix: NON_NULL_FIX,
		request: () => post({ query: '{ must }' }),
	},
	{
		name: 'a path that is not the GraphQL path',
		request: () => call({ path: '/nope', method: 'GET' }),
	},
	{
		name: 'a method that is not GET or POST',
		request: () => call({ method: 'PUT', body: '{}' }),
	},
	{
		name: 'an Accept header nothing can serve',
		request: () => post({ query: '{ hello }' }, { accept: 'text/html' }),
	},
	{
		name: 'a body that is too large',
		options: { limits: { bodyBytes: 10 } } as never,
		request: () => post({ query: '{ hello hello hello }' }),
	},
	{
		name: 'a Content-Type that is not JSON',
		request: () =>
			call({
				body: '{ hello }',
				headers: { 'content-type': 'text/plain', 'x-graphql-csrf': '1' },
			}),
	},
	{
		name: 'a body that is not JSON',
		request: () => call({ body: '{nope' }),
	},
	{
		name: 'a body whose parameters are wrong',
		request: () => post({ query: 1 }),
	},
	{
		name: 'a batch while batching is off',
		request: () => post([{ query: '{ hello }' }]),
	},
	{
		name: 'a batch over text/event-stream',
		options: { batching: { limit: 5 } } as never,
		request: () =>
			post([{ query: '{ hello }' }], { accept: 'text/event-stream' }),
	},
	{
		name: 'a request without the CSRF header',
		code: 'CSRF_HEADER_REQUIRED',
		request: () =>
			new Request('http://localhost/graphql?query=%7Bhello%7D', {
				headers: { accept: json },
			}),
	},
	{
		name: 'a cross-origin request',
		code: 'FORBIDDEN_ORIGIN',
		options: { csrf: { sameOrigin: true } } as never,
		request: () =>
			post({ query: '{ hello }' }, { origin: 'https://evil.example' }),
	},
	{
		name: 'a documentId that is not in the manifest',
		code: 'PERSISTED_QUERY_NOT_FOUND',
		options: { trustedDocuments: { manifest: {} } } as never,
		request: () => post({ documentId: 'nope' }),
	},
	{
		name: 'documentId and query together',
		code: 'BAD_USER_INPUT',
		options: { trustedDocuments: { manifest: { a: '{ hello }' } } } as never,
		request: () => post({ documentId: 'a', query: '{ hello }' }),
	},
	{
		name: 'a query in strict mode',
		code: 'PERSISTED_QUERY_ONLY',
		options: {
			trustedDocuments: { manifest: {}, mode: 'strict' },
		} as never,
		request: () => post({ query: '{ hello }' }),
	},
	{
		name: 'an APQ hash that does not match its query',
		code: 'PROVIDED_SHA_DOESNT_MATCH',
		options: { trustedDocuments: { manifest: {} } } as never,
		request: () =>
			post({
				query: '{ hello }',
				extensions: { persistedQuery: { version: 1, sha256Hash: 'ab' } },
			}),
	},
	{
		name: 'an APQ version other than 1',
		code: 'PERSISTED_QUERY_VERSION_NOT_SUPPORTED',
		options: { trustedDocuments: { manifest: {} } } as never,
		request: () =>
			post({
				extensions: { persistedQuery: { version: 2, sha256Hash: 'ab' } },
			}),
	},
	{
		name: 'a malformed persistedQuery extension',
		code: 'BAD_USER_INPUT',
		options: { trustedDocuments: { manifest: {} } } as never,
		request: () => post({ extensions: { persistedQuery: { version: 1 } } }),
	},
	{
		name: 'an APQ hash nobody registered, sent without a query',
		code: 'PERSISTED_QUERY_NOT_FOUND',
		options: { trustedDocuments: { manifest: {}, apq: true } } as never,
		request: () =>
			post({
				extensions: { persistedQuery: { version: 1, sha256Hash: 'ab' } },
			}),
	},
	{
		name: 'an APQ hash while apq is off',
		code: 'PERSISTED_QUERY_NOT_SUPPORTED',
		options: { trustedDocuments: { manifest: {}, apq: false } } as never,
		request: () =>
			post({
				extensions: { persistedQuery: { version: 1, sha256Hash: 'ab' } },
			}),
	},
	{
		name: 'a request while the server shuts down',
		code: 'SHUTTING_DOWN',
		before: (graxia) => graxia.dispose({ timeout: 10 }),
		request: () => post({ query: '{ hello }' }),
	},
];

/** The first error of a response body, whatever the shape of the refusal. */
const firstError = async (response: Response) => {
	const body = (await response.json()) as {
		errors?: { message: string; extensions?: Record<string, unknown> }[];
	};
	return body.errors?.[0];
};

describe.each(['development', 'production'])(
	'fix on every error (%s)',
	(env) => {
		for (const row of rows) {
			test(row.name, async () => {
				const graxia = createGraxia({
					schema,
					onUnexpected: false,
					...(env === 'production' ? { mode: 'production' } : {}),
					...(row.options ?? {}),
				} as Parameters<typeof createGraxia>[0]);
				await row.before?.(graxia);
				const error = await firstError(await graxia.fetch(row.request()));
				await graxia.dispose({ timeout: 10 });
				expect(error).toBeDefined();
				const fix = error?.extensions?.['fix'];
				expect(typeof fix).toBe('string');
				expect((fix as string).length).toBeGreaterThan(10);
				if (row.fix) expect(fix).toBe(row.fix);
				if (row.code) expect(error?.extensions?.['code']).toBe(row.code);
			});
		}
	},
);

describe('fix of the plugins and the abort', () => {
	test('a rate limit refusal and a single field selected twice', async () => {
		const limit = { consume: () => ({ allowed: false, retryAfter: 1000 }) };
		const graxia = createGraxia({
			schema,
			onUnexpected: false,
			plugins: [
				fieldRateLimit({
					fields: { hello: limit, signIn: { limit, single: true } },
					key: () => 'k',
				}),
			],
		} as Parameters<typeof createGraxia>[0]);
		const limited = await firstError(
			await graxia.fetch(post({ query: '{ hello }' })),
		);
		expect(limited?.extensions?.['code']).toBe('RATE_LIMITED');
		expect(limited?.extensions?.['fix']).toContain('Retry');
		const twice = await firstError(
			await graxia.fetch(post({ query: '{ a: signIn b: signIn }' })),
		);
		expect(twice?.extensions?.['code']).toBe('FIELD_SELECTED_ONCE');
		expect(typeof twice?.extensions?.['fix']).toBe('string');
		await graxia.dispose({ timeout: 10 });
	});

	test('an operation aborted by the shutdown', async () => {
		let started: () => void = () => {};
		const running = new Promise<void>((resolve) => {
			started = resolve;
		});
		const slow = createSchema()({
			typeDefs: 'type Query { stuck: String }',
			resolvers: {
				Query: {
					stuck: () => {
						started();
						return new Promise<string>(() => {});
					},
				},
			},
		});
		const graxia = createGraxia({ schema: slow, onUnexpected: false });
		const inflight = graxia.fetch(post({ query: '{ stuck }' }));
		await running;
		await graxia.dispose({ timeout: 20 });
		const error = await firstError(await inflight);
		expect(error?.extensions?.['code']).toBe('OPERATION_ABORTED');
		expect(typeof error?.extensions?.['fix']).toBe('string');
	});
});
