import { afterEach, describe, expect, test } from 'bun:test';
import { definePlugin } from '../plugins/define';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import { pubsub, raw, until } from './ws.test-util';

const schema = createSchema<{ signal: AbortSignal }>()({
	typeDefs: `
		type Query { hello: String boom: String }
		type Mutation { bump: Int }
		type Subscription { tick: Int! finite: Int }
	`,
	resolvers: {
		Query: {
			hello: () => 'world',
			boom: () => {
				throw new Error('nope');
			},
		},
		Mutation: { bump: () => 1 },
		Subscription: {
			tick: {
				subscribe: () => pubsub.subscribe('tick'),
				resolve: (n: number) => n,
			},
			finite: {
				subscribe: async function* () {
					yield 1;
					yield 2;
				},
				resolve: (n: number) => n,
			},
		},
	},
});

type Log = { type: string; tenant: string; end?: string };

type Host = { tenant: string; signal: AbortSignal };

/** The host's observer: start in onExecute/onSubscribe; end from the after-hook (query, mutation) or the operation's signal (subscription). */
function observer(log: Log[]) {
	return definePlugin<Host>()({
		name: 'observer',
		onExecute({ args }) {
			const operation = args.document.definitions[0];
			const entry: Log = {
				type:
					operation?.kind === 'OperationDefinition' ? operation.operation : '?',
				tenant: args.contextValue.tenant,
			};
			log.push(entry);
			return ({ result }) => {
				entry.end = result && 'errors' in result ? 'error' : 'ok';
			};
		},
		onSubscribe({ args }) {
			const entry: Log = {
				type: 'subscription',
				tenant: args.contextValue.tenant,
			};
			log.push(entry);
			// The signal aborts whenever the operation ends: client complete, socket close, shutdown, or its source finishing.
			args.contextValue.signal.addEventListener('abort', () => {
				entry.end ??= 'ended';
			});
		},
	});
}

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const stop of stops.splice(0)) await stop();
});

/** A host: Bun.serve upgrading with its own per-connection state as serverContext. */
function host(log: Log[]) {
	const graxia = createGraxia({
		schema,
		onUnexpected: false,
		plugins: [observer(log)],
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
	return { url: `ws://localhost:${server.port}/graphql` };
}

describe('a host observes each socket operation', () => {
	test('serverContext reaches the plugin and every operation has an end', async () => {
		const log: Log[] = [];
		const { url } = host(log);
		const s = raw(url);
		await s.init();
		const run = async (id: string, query: string, messages: number) => {
			await s.send({ id, type: 'subscribe', payload: { query } });
			for (let i = 0; i < messages; i++) await s.next();
		};
		await run('1', '{ hello }', 2);
		await run('2', 'mutation { bump }', 2);
		await run('3', '{ boom }', 2);
		await run('4', 'subscription { finite }', 3);
		await run('5', 'subscription { tick }', 0);
		await until(() => pubsub.subscriberCount('tick') === 1);
		await s.send({ id: '5', type: 'complete' });
		await until(() => pubsub.subscriberCount('tick') === 0);
		await run('6', 'subscription { tick }', 0);
		await until(() => pubsub.subscriberCount('tick') === 1);
		s.socket.close();
		await until(() => pubsub.subscriberCount('tick') === 0);
		await until(() => log.length === 6 && log.every((entry) => entry.end));
		expect(log).toEqual([
			{ type: 'query', tenant: 'acme', end: 'ok' },
			{ type: 'mutation', tenant: 'acme', end: 'ok' },
			{ type: 'query', tenant: 'acme', end: 'error' },
			{ type: 'subscription', tenant: 'acme', end: 'ended' },
			{ type: 'subscription', tenant: 'acme', end: 'ended' },
			{ type: 'subscription', tenant: 'acme', end: 'ended' },
		]);
	});
});
