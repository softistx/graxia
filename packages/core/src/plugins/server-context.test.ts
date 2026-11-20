import { afterEach, describe, expect, test } from 'bun:test';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import { raw } from '../ws/ws.test-util';
import { definePlugin } from './define';

type Hook = 'onRequest' | 'onParse' | 'onValidate';
type Host = { tenant: string; signal: AbortSignal };

const schema = createSchema<{ signal: AbortSignal }>()({
	typeDefs: 'type Query { hello: String }',
	resolvers: { Query: { hello: () => 'world' } },
});

/** A plugin recording the `serverContext` each hook sees. */
function spy(seen: Record<string, unknown[]>) {
	const record = (hook: Hook) => (payload: { serverContext: unknown }) => {
		seen[hook] = [...(seen[hook] ?? []), payload.serverContext];
	};
	return definePlugin<Host>()({
		name: 'spy',
		onRequest: record('onRequest'),
		onParse: record('onParse'),
		onValidate: record('onValidate'),
	});
}

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const stop of stops.splice(0)) await stop();
});

/** A host upgrading sockets with its own serverContext. */
function socketHost(plugin: ReturnType<typeof spy>) {
	const graxia = createGraxia({
		schema,
		onUnexpected: false,
		plugins: [plugin],
	});
	const server = Bun.serve({
		port: 0,
		fetch: (request, srv) => graxia.upgrade(request, srv, { tenant: 'acme' }),
		websocket: graxia.websocket,
	});
	stops.push(async () => {
		await graxia.dispose({ timeout: 200 });
		await server.stop(true);
	});
	return `ws://localhost:${server.port}/graphql`;
}

const post = (query: string) =>
	new Request('http://localhost/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query }),
	});

describe('over HTTP, each hook sees the host serverContext', () => {
	for (const hook of ['onRequest', 'onParse', 'onValidate'] as const) {
		test(hook, async () => {
			const seen: Record<string, unknown[]> = {};
			const graxia = createGraxia({
				schema,
				onUnexpected: false,
				plugins: [spy(seen)],
			});
			await graxia.fetch(post('{ hello }'), { tenant: 'acme' });
			await graxia.dispose({ timeout: 200 });
			expect(seen[hook]).toEqual([{ tenant: 'acme' }]);
		});
	}
});

describe('over a WebSocket, each hook sees the upgrade serverContext', () => {
	for (const hook of ['onRequest', 'onParse', 'onValidate'] as const) {
		test(hook, async () => {
			const seen: Record<string, unknown[]> = {};
			const s = raw(socketHost(spy(seen)));
			await s.init();
			await s.send({
				id: '1',
				type: 'subscribe',
				payload: { query: '{ hello }' },
			});
			await s.next();
			const contexts = seen[hook] ?? [];
			expect(contexts.length).toBeGreaterThan(0);
			const keys =
				hook === 'onRequest'
					? ['server', 'tenant']
					: ['connectionParams', 'server', 'tenant'];
			for (const context of contexts) {
				expect(Object.keys(context as object).sort()).toEqual(keys);
				expect((context as { tenant: string }).tenant).toBe('acme');
			}
		});
	}

	test('onValidate ties a failed document to its socket', async () => {
		const failures: { tenant: unknown; messages: string[] }[] = [];
		const plugin = definePlugin<Host>()({
			name: 'ties',
			onValidate:
				({ serverContext }) =>
				({ errors }) => {
					if (errors?.length)
						failures.push({
							tenant: serverContext['tenant'],
							messages: errors.map((error) => error.message),
						});
				},
		});
		const s = raw(socketHost(plugin));
		await s.init();
		await s.send({
			id: '1',
			type: 'subscribe',
			payload: { query: '{ nope }' },
		});
		const reply = await s.next();
		expect(reply.type).toBe('error');
		expect(failures).toEqual([
			{ tenant: 'acme', messages: [expect.stringContaining('nope')] },
		]);
	});
});
