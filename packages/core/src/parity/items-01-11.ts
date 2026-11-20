import { at, core, E, type ParityItem } from './item';

/** Parity items 1 to 11. */
export const ITEMS_1_11: readonly ParityItem[] = [
	{
		n: 1,
		item: 'host fetch, any path or prefix',
		specs: [
			...core(
				'server/http.test.ts',
				'path: false serves any path',
				'fetch takes a server context merged into the context',
			),
			...core(
				'parity/host.test.ts',
				'a prefixed path is served, the bare one is 404',
			),
			...at(E + 'app.test.ts', 'serves graphql under the prefix'),
		],
	},
	{
		n: 2,
		item: 'typed host context, context factory, compile check',
		specs: [
			...core('server/host-context.test-d.ts'),
			...core('server/infer-context.test-d.ts'),
			...core('schema/types.test-d.ts'),
			...core(
				'server/context.test.ts',
				'serverContext, then context(), then onContext',
			),
			...at(E + 'context.test-d.ts'),
		],
	},
	{
		n: 3,
		item: 'resolvers set headers and cookies',
		specs: [
			...core(
				'parity/host.test.ts',
				'a resolver sets a header and a cookie through the host context',
			),
			...at(E + 'app.test.ts', 'a resolver sets a cookie and a header'),
		],
		differs: 'Setting a header or a cookie',
	},
	{
		n: 4,
		item: '15 000 tokens, 1 000 nesting, stack overflow',
		specs: [
			...core(
				'document/pipeline.test.ts',
				'tokens: at the boundary passes, over fails with limit and fix',
				'nesting counts brackets, not strings, comments or block strings',
				'a parser stack overflow is a parse failure, not a crash',
			),
			...core(
				'server/hardening.test.ts',
				'a stack overflow is GRAPHQL_PARSE_FAILED, not masked',
			),
			...core(
				'production.test.ts',
				'a document over the token limit is refused',
			),
		],
	},
	{
		n: 5,
		item: 'weighted parse cache and validation cache',
		specs: [
			...core(
				'document/lru.test.ts',
				'evicts by total weight, and skips an entry over maxWeight / 8',
				'document cache evicts by weight',
			),
			...core(
				'document/pipeline.test.ts',
				'hit returns the same DocumentNode; failures are cached',
				'returns the document or the errors, and caches by source',
			),
		],
	},
	{
		n: 6,
		item: '1 MiB body limit, 413 keeps plugin headers',
		specs: [
			...core(
				'server/http.test.ts',
				'413 past the limit keeps the plugin header',
				'413 on a chunked body without Content-Length',
			),
			...core('production.test.ts', 'a body over 1 MiB answers 413'),
		],
	},
	{
		n: 7,
		item: '415 on a non-JSON body',
		specs: [
			...core(
				'server/http.test.ts',
				'415 on a non-JSON content type, keeps the plugin header',
			),
			...core(
				'uploads/uploads.test.ts',
				'multipart while uploads are off: 415',
			),
		],
	},
	{
		n: 8,
		item: 'CSRF custom headers',
		specs: core(
			'security/csrf.test.ts',
			'a custom list replaces the defaults',
			'a GET without a header is refused with the exact body',
		),
	},
	{
		n: 9,
		item: 'sameOrigin with its full semantics',
		specs: core(
			'security/origin.test.ts',
			'same origin, no Origin, and an allowed origin pass',
			'a null origin is always refused, even with crossOrigin: allow',
			'crossOrigin refuse, json and allow',
			'Sec-Fetch-Site: cross-site without Origin is a cross origin',
			'a custom status and body replace the default 403',
			'an async onRefused is awaited',
			'it gets the request, the reason and websocket: false of each refusal',
			'same-site without Origin is no-origin',
			'returning undefined, or a non-Response, gives the default 403',
			'it is not called for an allowed request, and the default stays without it',
			'crossOrigin json refuses a simple request through it',
			'no-store is added, an existing cache-control is kept',
			'a throwing or rejecting onRefused is a 500 reported once',
			'it answers a refused WebSocket upgrade, async too, with websocket: true',
		),
	},
	{
		n: 10,
		item: 'persisted operations: strict, sha256, custom key, codes',
		specs: [
			...core(
				'trusted/trusted.test.ts',
				'strict refuses an arbitrary query and accepts a manifest id',
				'strict with extractKey and a store runs what the store holds',
			),
			...core(
				'trusted/ids.test.ts',
				'a sha256 documentId finds the manifest entry by its hex',
				'takes the id from the request, first',
			),
			...core(
				'trusted/apq.test.ts',
				'apq off answers PersistedQueryNotSupported',
			),
		],
	},
	{
		n: 11,
		item: 'depth limit',
		specs: [
			...core('limits/limits.test.ts', 'refuses one over with the limit shape'),
			...at('packages/envelop/src/depth-limit.test.ts'),
		],
	},
];
