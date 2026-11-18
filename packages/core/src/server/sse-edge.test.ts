import { afterEach, expect, test } from 'bun:test';
import { definePlugin } from '../plugins/define';
import { createSchema } from '../schema/create-schema';
import { getContext } from './context';
import { createGraxia, type Graxia } from './create-graxia';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const schema = createSchema()({
	typeDefs: `
		type Query { _: Int }
		type Subscription { stuck: Int! one: Int! }
	`,
	resolvers: {
		Subscription: {
			stuck: {
				// A source whose `return()` throws synchronously.
				subscribe: (): AsyncIterable<unknown> => ({
					[Symbol.asyncIterator]: (): AsyncIterator<unknown> => ({
						next: () => new Promise<never>(() => {}),
						return: () => {
							throw new Error('return failed');
						},
					}),
				}),
				resolve: (n: number) => n,
			},
			one: {
				subscribe: async function* () {
					yield 1;
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
const request = (query: string, signal?: AbortSignal) =>
	new Request('http://x/graphql', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'text/event-stream',
		},
		body: JSON.stringify({ query }),
		signal: signal ?? null,
	});

test('a source whose return() throws still lets dispose() resolve promptly', async () => {
	const stuck = definePlugin()({
		name: 'stuck',
		onSubscribe: ({ setResult }) => {
			setResult({
				[Symbol.asyncIterator]: (): AsyncIterator<unknown> => ({
					next: () => new Promise<never>(() => {}),
					return: () => {
						throw new Error('return failed');
					},
				}),
			} as never);
		},
	});
	const graxia = make({ shutdownTimeout: 5000, plugins: [stuck] });
	const controller = new AbortController();
	const response = await graxia.fetch(
		request('subscription { stuck }', controller.signal),
	);
	controller.abort();
	await sleep(20);
	const started = performance.now();
	await graxia.dispose();
	expect(performance.now() - started).toBeLessThan(1000);
	await response.body?.cancel().catch(() => {});
});

test('getContext() works inside onResultChunk hooks of a stream', async () => {
	let seen: unknown;
	const plugin = definePlugin()({
		name: 'ctx',
		onContext: () => ({ user: 'ada' }),
		onResultChunk: () => {
			seen = (getContext() as { user?: string }).user;
		},
	});
	const graxia = make({ plugins: [plugin] });
	const response = await graxia.fetch(request('subscription { one }'));
	await response.text();
	expect(seen).toBe('ada');
});

test('getContext() works inside onResultChunk hooks of a single SSE result', async () => {
	let seen: unknown;
	const graxia = make({
		plugins: [
			definePlugin()({
				name: 'ctx',
				onContext: () => ({ user: 'ada' }),
				onResultChunk: () => {
					seen = (getContext() as { user?: string }).user;
				},
			}),
		],
	});
	const response = await graxia.fetch(request('{ _ }'));
	await response.text();
	expect(seen).toBe('ada');
});
