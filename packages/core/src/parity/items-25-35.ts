import { at, core, E, type ParityItem } from './item';

/** Parity items 25 to 35. */
export const ITEMS_25_35: readonly ParityItem[] = [
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
			'spec: true drops the status over SSE, as in Yoga, its headers still apply',
			'a rate-limited SSE subscription stays a 200 stream with no retry-after',
			'a throwing onResultChunk gives a 200 stream with Unexpected error., reported once',
			'onResultChunk runs once for the pre-stream payload and its change sets the status',
			'over multipart/mixed a subscription is not served, so there is no stream to refuse',
			'errorHttp: false keeps the 200 stream with the errors in a next event',
			'without extensions.http it stays a 200 stream',
			'a failure after the first event stays in the stream, http stripped',
		),
		differs: 'Status and headers from errors',
	},
];
