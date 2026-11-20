/**
 * The 33 items of `docs/plan.md` §5 (what `@alxia/graphql` 0.16.4 gives a
 * host) and items 34 and 35 (the status `@alxia/graphql` up to 0.16, on Yoga, answered), each with the specs that prove graxia covers it. `checklist.test.ts`
 * fails when a file is gone, a test title no longer appears in its file, or a
 * divergence has no section in the migration guide: rename a referenced test
 * and this table follows.
 */
export interface ParityItem {
	n: number;
	item: string;
	/** Repository-relative files; `test` is a title the file must contain. */
	specs: readonly { file: string; test?: string }[];
	/** The `##` heading of the migration guide that explains a deliberate difference. */
	differs?: string;
}

const C = 'packages/core/src/';
const E = 'examples/host-embedding/src/';
const core = (file: string, ...tests: string[]) =>
	tests.length === 0
		? [{ file: C + file }]
		: tests.map((test) => ({ file: C + file, test }));
const at = (file: string, ...tests: string[]) =>
	tests.length === 0 ? [{ file }] : tests.map((test) => ({ file, test }));

export const PARITY: readonly ParityItem[] = [
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
	{
		n: 12,
		item: 'introspection off outside development',
		specs: [
			...core(
				'security/introspection.test.ts',
				'true allows it, and the default follows NODE_ENV',
			),
			...core('production.test.ts', '__schema and __type are refused'),
		],
	},
	{
		n: 13,
		item: 'error masking, originalError stripped',
		specs: [
			...core(
				'server/errors.test.ts',
				'a plain Error is masked with path, locations and a correlation id',
			),
			...core(
				'production.test.ts',
				'an unexpected resolver error is masked and reported',
			),
		],
	},
	{
		n: 14,
		item: 'batching off, or with a limit',
		specs: core(
			'server/http.test.ts',
			'off: an array is 400',
			'on: runs each entry and answers an array',
			'over the limit is 400',
		),
	},
	{
		n: 15,
		item: 'SSE over GET and POST, 12 s keep-alive',
		specs: [
			...core(
				'server/sse.test.ts',
				'GET works, a mutation over GET stays 405',
				'keep-alive comments flow while the stream is open',
				'graphql-sse client receives PubSub events and completes',
			),
			...core(
				'parity/streams.test.ts',
				'SSE and WebSocket keep-alive default to 12 000 ms',
			),
		],
	},
	{
		n: 16,
		item: 'multipart incremental delivery',
		specs: core(
			'server/incremental.test.ts',
			'initial, deferred and last payload parse with meros',
			'initialCount 1 over an async generator',
		),
	},
	{
		n: 17,
		item: 'streams ended on shutdown',
		specs: [
			...core(
				'server/sse.test.ts',
				'dispose() completes open streams and resolves quickly',
			),
			...core(
				'server/incremental-edge.test.ts',
				'dispose cuts an incremental stream that outlives shutdownTimeout, and closes it',
			),
			...core(
				'ws/lifecycle.test.ts',
				'dispose closes every socket with 1001, promptly, ending the sources',
			),
		],
	},
	{
		n: 18,
		item: 'WebSocket on the same path through the host upgrade, params, keep-alive or off, 1001, drain',
		specs: [
			...core('ws/lifecycle.test.ts', 'graxia.upgrade and graxia.websocket'),
			...core(
				'ws/client.test.ts',
				'connectionParams reach onConnect and the context',
			),
			...core('ws/protocol.test.ts', 'the server pings every keepAliveMs'),
			...core('parity/streams.test.ts', 'keepAliveMs: 0 sends no ping'),
			...at(E + 'app.test.ts', 'stop() drains'),
		],
	},
	{
		n: 19,
		item: 'per-operation reporting over HTTP, batch and WebSocket',
		specs: [
			...core(
				'telemetry/http.test.ts',
				'a batch is one request span and one operation span per entry',
				'a named operation is',
			),
			...core(
				'telemetry/stream.test.ts',
				'the upgrade has a short request span and each subscribe an operation span',
			),
		],
		differs: 'Reporting operations',
	},
	{
		n: 20,
		item: 'request id never trusted, quiet logs',
		specs: [
			...core('server/http.test.ts', 'a client x-request-id is never echoed'),
			...core(
				'server/hardening.test.ts',
				'an invalid incoming x-request-id is ignored; getRequestId gives the generated id',
			),
			...core('parity/host.test.ts', 'requests write nothing to the console'),
		],
		differs: 'Request id and logs',
	},
	{
		n: 21,
		item: 'GraphiQL development only, Sandbox, CSP',
		specs: [
			...at(
				'packages/graphiql/src/graphiql.test.ts',
				'production disables it by default, true enables it',
				'the CSP has no external source',
			),
			...at(
				'packages/graphiql/src/sandbox.test.ts',
				'the CSP names the exact Apollo hosts and nothing else',
			),
		],
		differs: 'Explorer',
	},
	{
		n: 22,
		item: 'fieldRateLimit in full',
		specs: [
			...core(
				'rate-limit/plugin.test.ts',
				'429 with Retry-After, no-store, code and retryAfter seconds',
				'a custom code',
				'ctx.ip, then ipv6Prefix',
				'fields are charged in document order and spent units stay spent',
			),
			...core('rate-limit/count.test.ts'),
			...core('rate-limit/store.test.ts'),
		],
	},
	{
		n: 23,
		item: 'in-process executor with a signal',
		specs: core(
			'server/execute.test.ts',
			'runs a string document',
			'signal aborts the operation',
		),
	},
	{
		n: 24,
		item: 'test client',
		specs: core(
			'testing/client.test.ts',
			'POST and GET queries',
			'persisted: true sends the APQ extension with the computed hash',
		),
	},
	{
		n: 25,
		item: 'CORS left to the host',
		specs: [
			...core(
				'parity/host.test.ts',
				'CORS is left to the host: no access-control header, OPTIONS is 405',
			),
			...at(E + 'app.test.ts', "CORS is the host's"),
		],
		differs: 'CORS',
	},
	{
		n: 26,
		item: 'Envelop plugins through an adapter',
		specs: [
			...at(
				'packages/envelop/src/from-envelop.test.ts',
				'an empty list is a plugin that does nothing',
			),
			...at('packages/envelop/src/generic-auth.test.ts'),
			...at('packages/envelop/src/response-cache.test.ts'),
			...at('packages/envelop/src/persisted-operations.test.ts'),
		],
	},
	{
		n: 27,
		item: 'multipart uploads',
		specs: core(
			'uploads/uploads.test.ts',
			'a resolver reads the file name, type, size and content',
			'no CSRF header: 403 before the body is read',
		),
	},
	{
		n: 28,
		item: 'one stable context per operation',
		specs: [
			...core(
				'server/context.test.ts',
				'each batch entry has its own context and signal',
			),
			...core(
				'parity/host.test.ts',
				'one context object per operation, deferred fields included',
			),
		],
	},
	{
		n: 29,
		item: 'abort signal reaches subscription resolvers',
		specs: [
			...core(
				'pubsub/memory.test.ts',
				'the operation signal ends the subscriber at once, with no next() pending',
			),
			...core('server/sse.test.ts', 'aborting the request ends the source'),
			...core(
				'parity/streams.test.ts',
				"a subscription resolver's signal aborts when the client leaves (SSE and WebSocket)",
			),
		],
	},
	{
		n: 30,
		item: 'configurable WebSocket message limit',
		specs: core('ws/protocol.test.ts', '1009 above maxPayloadBytes'),
	},
	{
		n: 31,
		item: 'actionable missing-peer errors',
		specs: [
			...core(
				'telemetry/options.test.ts',
				'without the package (loader finds nothing) there is no span and no wrapping',
			),
			...at(
				'packages/graphiql/src/detect.test.ts',
				'names the URL and the fix, and is not cached',
			),
			...core('parity/peers.test.ts', 'nothing to install beyond graphql'),
		],
		differs: 'Peers',
	},
	{
		n: 32,
		item: 'host shutdown signal',
		specs: [
			...core(
				'server/dispose.test.ts',
				'new requests get 503 SHUTTING_DOWN while in-flight ones finish',
				'past the timeout the remaining operations are aborted',
			),
			...at(E + 'app.test.ts', 'stop() drains'),
		],
		differs: 'Shutdown',
	},
	{
		n: 33,
		item: 'graphql 16 dropped',
		specs: core(
			'parity/peers.test.ts',
			'graphql 16 is outside the peer range, 17.1 inside',
		),
		differs: 'graphql 17',
	},
	{
		n: 34,
		item: 'extensions.http status and headers on errors',
		specs: core(
			'server/error-http.test.ts',
			'a field error with status 409 answers 409 with its data',
			'the highest of several statuses wins',
			'the headers of the errors are merged',
			'http is stripped from the serialized extensions',
			'spec: true ignores the status under application/json only, headers still apply',
			'a masked unexpected error carrying http has no effect',
			'a plugin refusal wins over the status of the errors, their headers merge under its own',
			'a batch is unaffected',
			'exposedError with extensions.http, the documented path',
			'on a header clash the later error wins',
			'outcome.status wins over the errors',
			'plugin headers win over the errors headers',
			'an error cannot set framing headers, content-encoding included',
			'plain-object errors from a plugin setResult answer 409 and lose http',
			"an onResponse plugin's header wins over the errors' headers",
			'a response replaced in onResponse carries no error header',
			'the 500 of a throwing onResponse carries no error header',
			'a deferred payload has no http in its extensions',
			'a batch entry has no http in its extensions',
			'an SSE next event has no http in its extensions',
			'a WebSocket next message has no http in its extensions',
			'errorHttp: false turns it off',
		),
		differs: 'Status and headers from errors',
	},
	{
		n: 35,
		item: 'A subscription refused before its stream opens keeps the event stream with its extensions.http status',
		specs: core(
			'server/subscription-http.test.ts',
			'over SSE it keeps the stream with the status and headers of its errors',
			'over SSE a 403 answers 403',
			'spec: true does not drop the status over SSE, as in Yoga',
			'onResultChunk runs once for the pre-stream payload and its change sets the status',
			'over multipart/mixed a subscription is not served, so there is no stream to refuse',
			'errorHttp: false keeps the 200 stream with the errors in a next event',
			'without extensions.http it stays a 200 stream',
			'a failure after the first event stays in the stream, http stripped',
		),
		differs: 'Status and headers from errors',
	},
];
