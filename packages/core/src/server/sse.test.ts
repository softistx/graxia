import { afterEach, describe, expect, test } from 'bun:test';
import { createClient } from 'graphql-sse';
import { definePlugin } from '../plugins/define';
import { createMemoryPubSub } from '../pubsub/memory';
import { createSchema } from '../schema/create-schema';
import { getContext } from './context';
import { createGraxia, type Graxia } from './create-graxia';

type Topics = { tick: number; bad: number };
const pubsub = createMemoryPubSub<Topics>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const schema = createSchema<{ signal: AbortSignal }>()({
	typeDefs: `
		type Query { hello: String }
		type Mutation { bump: Int }
		type Subscription { tick: Int! bad: Int! who: String! ended: Int! }
	`,
	resolvers: {
		Query: { hello: () => 'world' },
		Mutation: { bump: () => 1 },
		Subscription: {
			tick: {
				subscribe: (_: unknown, __: unknown, ctx) =>
					pubsub.subscribe('tick', { signal: ctx.signal }),
				resolve: (n: number) => n,
			},
			bad: {
				subscribe: (_: unknown, __: unknown, ctx) =>
					pubsub.subscribe('bad', { signal: ctx.signal }),
				resolve: () => {
					throw new Error('secret detail');
				},
			},
			who: {
				subscribe: (_: unknown, __: unknown, ctx) =>
					pubsub.subscribe('tick', { signal: ctx.signal }),
				resolve: () => String((getContext() as { user?: string }).user),
			},
			ended: {
				subscribe: async function* () {
					yield 1;
					yield 2;
				},
				resolve: (n: number) => n,
			},
		},
	},
});

const open: Graxia<any>[] = [];
afterEach(async () => {
	await Promise.all(open.splice(0).map((g) => g.dispose({ timeout: 200 })));
});
const make = (options: Record<string, unknown> = {}) => {
	const g = createGraxia({ schema, onUnexpected: false, ...options });
	open.push(g);
	return g;
};
const sse = (body: unknown, extra: HeadersInit = {}) =>
	new Request('http://x/graphql', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'text/event-stream',
			...extra,
		},
		body: JSON.stringify(body),
	});

async function read(response: Response, until: (text: string) => boolean) {
	const reader = (response.body as ReadableStream<Uint8Array>).getReader();
	const decoder = new TextDecoder();
	let text = '';
	while (!until(text)) {
		const { value, done } = await reader.read();
		if (done) break;
		text += decoder.decode(value);
	}
	reader.releaseLock();
	return text;
}
const events = (text: string) => text.replace(/^:\n\n/gm, '');

describe('wire format', () => {
	test('a query is one next then complete, with the stream headers', async () => {
		const response = await make().fetch(sse({ query: '{ hello }' }));
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe(
			'text/event-stream; charset=utf-8',
		);
		expect(response.headers.get('cache-control')).toBe('no-cache');
		expect(response.headers.get('x-accel-buffering')).toBe('no');
		expect(response.headers.get('vary')).toContain('Accept');
		const text = await response.text();
		expect(events(text)).toBe(
			'event: next\ndata: {"data":{"hello":"world"}}\n\nevent: complete\ndata:\n\n',
		);
	});
	test('GET works, a mutation over GET stays 405', async () => {
		const graxia = make();
		const get = await graxia.fetch(
			new Request(`http://x/graphql?query=${encodeURIComponent('{ hello }')}`, {
				headers: { accept: 'text/event-stream' },
			}),
		);
		expect(events(await get.text())).toContain('"hello":"world"');
		const mutation = await graxia.fetch(
			new Request(
				`http://x/graphql?query=${encodeURIComponent('mutation { bump }')}`,
				{ headers: { accept: 'text/event-stream' } },
			),
		);
		expect(mutation.status).toBe(405);
		expect(mutation.headers.get('allow')).toBe('POST');
	});
	test('a validation error is a next event with errors, status 200', async () => {
		const response = await make().fetch(sse({ query: '{ nope }' }));
		expect(response.status).toBe(200);
		const text = events(await response.text());
		expect(text).toContain('event: next');
		expect(text).toContain('Cannot query field');
		expect(text.endsWith('event: complete\ndata:\n\n')).toBe(true);
	});
	test('request-level failures keep their JSON answer', async () => {
		const graxia = make();
		const noQuery = await graxia.fetch(sse({}));
		expect(noQuery.status).toBe(400);
		expect(noQuery.headers.get('content-type')).toContain('application/json');
		const bad = await graxia.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: { 'content-type': 'text/plain', accept: 'text/event-stream' },
				body: 'x',
			}),
		);
		expect(bad.status).toBe(415);
	});
	test('a batch with an event-stream Accept is a 400', async () => {
		const response = await make({ batching: { limit: 2 } }).fetch(
			sse([{ query: '{ hello }' }]),
		);
		expect(response.status).toBe(400);
	});
	test('a subscription without the event-stream Accept is refused, saying so', async () => {
		const response = await make().fetch(
			sse({ query: 'subscription { tick }' }, { accept: 'application/json' }),
		);
		const body = (await response.json()) as any;
		expect(body.errors[0].extensions.code).toBe('SUBSCRIPTION_NOT_SUPPORTED');
		expect(body.errors[0].message).toContain('text/event-stream');
	});
	test('subscriptions.sse false restores the refusal', async () => {
		const response = await make({ subscriptions: { sse: false } }).fetch(
			sse({ query: 'subscription { tick }' }),
		);
		expect(response.headers.get('content-type')).toContain('application/json');
	});
	test('sse.keepAliveMs is validated: an integer from 0 to 2147483647', () => {
		for (const keepAliveMs of [
			-1,
			1.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			2_147_483_648,
		])
			expect(() => make({ subscriptions: { sse: { keepAliveMs } } })).toThrow(
				'subscriptions.sse.keepAliveMs must be an integer from 0 to 2147483647 (milliseconds, 0 turns keep-alive comments off)',
			);
		expect(() =>
			make({ subscriptions: { sse: { keepAliveMs: 0 } } }),
		).not.toThrow();
	});
	test('sse.keepAliveMs 0 sends no keep-alive comment', async () => {
		const response = await make({
			subscriptions: { sse: { keepAliveMs: 0 } },
		}).fetch(sse({ query: 'subscription { tick }' }));
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		await reader.read(); // the opening comment
		const next = await Promise.race([
			reader.read(),
			new Promise<'quiet'>((resolve) => setTimeout(resolve, 150, 'quiet')),
		]);
		expect(next).toBe('quiet');
		await reader.cancel();
	});
});

describe('subscriptions', () => {
	test('events arrive as next events and the source ending completes', async () => {
		const response = await make().fetch(
			sse({ query: 'subscription { ended }' }),
		);
		expect(events(await response.text())).toBe(
			'event: next\ndata: {"data":{"ended":1}}\n\nevent: next\ndata: {"data":{"ended":2}}\n\nevent: complete\ndata:\n\n',
		);
	});
	test('graphql-sse client receives PubSub events and completes', async () => {
		const graxia = make();
		const client = createClient({
			url: 'http://x/graphql',
			fetchFn: (input: any, init: any) =>
				graxia.fetch(new Request(input, init)),
			retryAttempts: 0,
		});
		const received: unknown[] = [];
		const done = new Promise<void>((resolve, reject) =>
			client.subscribe(
				{ query: 'subscription { tick }' },
				{
					next: (value) => received.push(value),
					error: reject,
					complete: resolve,
				},
			),
		);
		while (pubsub.subscriberCount('tick') === 0) await sleep(5);
		await pubsub.publish('tick', 1);
		await pubsub.publish('tick', 2);
		while (received.length < 2) await sleep(5);
		await graxia.dispose();
		await done;
		expect(received).toEqual([{ data: { tick: 1 } }, { data: { tick: 2 } }]);
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});
	test('graphql-sse client runs a query and reports a validation error', async () => {
		const graxia = make();
		const client = createClient({
			url: 'http://x/graphql',
			fetchFn: (input: any, init: any) =>
				graxia.fetch(new Request(input, init)),
			retryAttempts: 0,
		});
		const collect = async (query: string) => {
			const out: any[] = [];
			for await (const r of client.iterate({ query })) out.push(r);
			return out;
		};
		expect(await collect('{ hello }')).toEqual([{ data: { hello: 'world' } }]);
		const invalid = await collect('{ nope }');
		expect(invalid[0].errors[0].message).toContain('Cannot query field');
	});
	test('keep-alive comments flow while the stream is open', async () => {
		const response = await make({
			subscriptions: { sse: { keepAliveMs: 20 } },
		}).fetch(sse({ query: 'subscription { tick }' }));
		const text = await read(response, (t) => t.split(':\n\n').length > 3);
		expect(text.split(':\n\n').length).toBeGreaterThan(3);
		await response.body?.cancel();
	});
	test('a resolver error in an event is masked with a correlation id', async () => {
		const reported: unknown[] = [];
		const graxia = make({ onUnexpected: (e: unknown) => reported.push(e) });
		const response = await graxia.fetch(sse({ query: 'subscription { bad }' }));
		await pubsub.publish('bad', 1);
		const text = await read(response, (t) => t.includes('event: next'));
		expect(text).toContain('Unexpected error.');
		expect(text).toContain('correlationId');
		expect(text).not.toContain('secret detail');
		expect((reported[0] as Error).message).toBe('secret detail');
		await response.body?.cancel();
	});
	test('onResultChunk setChunk applies before masking, query included', async () => {
		const order: string[] = [];
		const plugin = definePlugin({
			name: 'chunks',
			onResultChunk: ({ chunk, setChunk }) => {
				order.push('chunk');
				setChunk({ ...(chunk as object), extensions: { via: 'plugin' } });
			},
		});
		const graxia = make({ plugins: [plugin] });
		const text = await (await graxia.fetch(sse({ query: '{ hello }' }))).text();
		expect(text).toContain('"extensions":{"via":"plugin"}');
		expect(order).toEqual(['chunk']);
	});
	test('onSubscribe setResult short-circuits with a single result, after-hook runs', async () => {
		let after: unknown;
		const plugin = definePlugin({
			name: 'sub',
			onSubscribe: ({ setResult }) => {
				setResult({ data: { tick: 7 } });
				return ({ result }) => {
					after = result;
				};
			},
		});
		const graxia = make({ plugins: [plugin] });
		const text = events(
			await (
				await graxia.fetch(sse({ query: 'subscription { tick }' }))
			).text(),
		);
		expect(text).toBe(
			'event: next\ndata: {"data":{"tick":7}}\n\nevent: complete\ndata:\n\n',
		);
		expect(after).toEqual({ data: { tick: 7 } });
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});
	test('getContext() works inside a per-event resolve', async () => {
		const plugin = definePlugin({
			name: 'user',
			onContext: () => ({ user: 'ada' }),
		});
		const graxia = make({ plugins: [plugin] });
		const response = await graxia.fetch(sse({ query: 'subscription { who }' }));
		while (pubsub.subscriberCount('tick') === 0) await sleep(5);
		await pubsub.publish('tick', 1);
		const text = await read(response, (t) => t.includes('event: next'));
		expect(text).toContain('{"data":{"who":"ada"}}');
		await response.body?.cancel();
	});
});

describe('cancellation', () => {
	test('aborting the request ends the source', async () => {
		const graxia = make({ subscriptions: { sse: { keepAliveMs: 20 } } });
		const controller = new AbortController();
		const request = new Request('http://x/graphql', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'text/event-stream',
			},
			body: JSON.stringify({ query: 'subscription { tick }' }),
			signal: controller.signal,
		});
		const response = await graxia.fetch(request);
		expect(pubsub.subscriberCount('tick')).toBe(1);
		controller.abort();
		await sleep(30);
		expect(pubsub.subscriberCount('tick')).toBe(0);
		await response.body?.cancel().catch(() => {});
	});
	test('cancelling the body ends the source', async () => {
		const graxia = make();
		const response = await graxia.fetch(
			sse({ query: 'subscription { tick }' }),
		);
		expect(pubsub.subscriberCount('tick')).toBe(1);
		await response.body?.cancel();
		await sleep(10);
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});
	test('dispose() completes open streams and resolves quickly', async () => {
		const graxia = make({ shutdownTimeout: 5000 });
		const response = await graxia.fetch(
			sse({ query: 'subscription { tick }' }),
		);
		const reading = response.text();
		const started = performance.now();
		await graxia.dispose();
		expect(performance.now() - started).toBeLessThan(1000);
		expect(events(await reading)).toBe('event: complete\ndata:\n\n');
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});
});
