import { afterEach } from 'bun:test';
import { createPubSub } from '../pubsub/memory';
import { createSchema } from '../schema/create-schema';
import { getContext } from '../server/context';
import { createGraxia, type Graxia } from '../server/create-graxia';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const pubsub = createPubSub<{ tick: [payload: number] }>();

export const schema = createSchema<{ signal: AbortSignal }>()({
	typeDefs: `
		type Query { hello: String who: String user: User }
		type User { name: String slow: String }
		type Mutation { bump: Int }
		type Subscription { tick: Int! boom: Int who: String }
	`,
	resolvers: {
		Query: {
			hello: () => 'world',
			who: (_: unknown, __: unknown, ctx) =>
				String(
					(ctx as { connectionParams?: { user?: string } }).connectionParams
						?.user,
				),
			user: () => ({}),
		},
		User: {
			name: () => 'Ada',
			slow: async () => {
				await sleep(20);
				return 'late';
			},
		},
		Mutation: { bump: () => 1 },
		Subscription: {
			tick: {
				subscribe: () => pubsub.subscribe('tick'),
				resolve: (n: number) => n,
			},
			boom: {
				subscribe: () => pubsub.subscribe('tick'),
				resolve: () => {
					throw new Error('secret detail');
				},
			},
			who: {
				subscribe: () => pubsub.subscribe('tick'),
				resolve: () => String((getContext() as { who?: string }).who),
			},
		},
	},
});

let current: Graxia | undefined;
const sockets: WebSocket[] = [];

/** A graxia on a real server (port 0), closed after the test. */
export function start(
	options: Partial<Parameters<typeof createGraxia>[0]> = {},
) {
	const graxia = createGraxia({ schema, onUnexpected: false, ...options });
	current = graxia;
	const server = graxia.serve({ port: 0 });
	return { graxia, server, url: `ws://localhost:${server.port}/graphql` };
}

afterEach(async () => {
	for (const socket of sockets.splice(0)) socket.close();
	await current?.dispose({ timeout: 200 });
	current = undefined;
});

/** A raw WebSocket collecting its JSON messages. */
export function raw(
	url: string,
	protocols: string | string[] = 'graphql-transport-ws',
) {
	const socket = new WebSocket(url, protocols);
	sockets.push(socket);
	const queue: any[] = [];
	const waiting: ((value: any) => void)[] = [];
	const closed = new Promise<{ code: number; reason: string }>((resolve) =>
		socket.addEventListener('close', (event) =>
			resolve({ code: event.code, reason: event.reason }),
		),
	);
	const opened = new Promise<void>((resolve) =>
		socket.addEventListener('open', () => resolve()),
	);
	socket.addEventListener('message', (event) => {
		const message = JSON.parse(String(event.data));
		const waiter = waiting.shift();
		if (waiter) waiter(message);
		else queue.push(message);
	});
	return {
		socket,
		closed,
		opened,
		send: async (message: unknown) => {
			await opened;
			socket.send(
				typeof message === 'string' ? message : JSON.stringify(message),
			);
		},
		next: (): Promise<any> =>
			queue.length > 0
				? Promise.resolve(queue.shift())
				: new Promise((resolve) => waiting.push(resolve)),
		/** Sends `connection_init` and waits for the ack. */
		init: async function (payload?: object) {
			await this.send({
				type: 'connection_init',
				...(payload ? { payload } : {}),
			});
			return this.next();
		},
	};
}

export async function until(check: () => boolean, ms = 2000) {
	const end = Date.now() + ms;
	while (!check() && Date.now() < end) await sleep(10);
}
