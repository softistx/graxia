import { at, core, E, type ParityItem } from './item';

/** Parity items 12 to 24. */
export const ITEMS_12_24: readonly ParityItem[] = [
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
];
