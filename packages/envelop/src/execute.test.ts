import { afterEach, describe, expect, test } from 'bun:test';
import { createSchema } from '@graxia/core';
import { GraphQLError } from 'graphql';
import { type Booted, boot, calls, pubsub } from './fixtures.test-util';
import { fromEnvelop } from './from-envelop';

let app: Booted;
afterEach(() => app.stop());
const DEFER = '{ hello user(id: "1") { name ... @defer { bio } } }';
const MULTIPART = 'multipart/mixed';
const SSE = 'text/event-stream';

const start = (hooks: object) => {
	app = boot([fromEnvelop([hooks as never])]);
	return app;
};

describe('onExecute', () => {
	test('setExecuteFn wraps execution', async () => {
		let wrapped = 0;
		start({
			onExecute: ({ executeFn, setExecuteFn }: any) =>
				setExecuteFn((a: unknown) => {
					wrapped++;
					return executeFn(a);
				}),
		});
		const answer = await app.gql('{ hello }');
		expect(wrapped).toBe(1);
		expect(answer.json.data.hello).toBe('world');
	});

	test('a coercion error stays unmasked through the wrapped executeFn', async () => {
		start({
			onExecute: ({ executeFn, setExecuteFn }: any) => setExecuteFn(executeFn),
		});
		const answer = await app.gql('query($id: ID!) { user(id: $id) { id } }', {
			variables: {},
		});
		expect(answer.json.errors[0].message).toContain('$id');
	});

	test('setResultAndStopExecution answers without running resolvers', async () => {
		calls.reset();
		start({
			onExecute: ({ setResultAndStopExecution }: any) =>
				setResultAndStopExecution({ data: { hello: 'cached' } }),
		});
		const answer = await app.gql('{ hello }');
		expect(answer.json.data.hello).toBe('cached');
		expect(calls.hello).toBe(0);
	});

	test('onExecuteDone setResult replaces the result', async () => {
		start({
			onExecute: () => ({
				onExecuteDone: ({ setResult }: any) =>
					setResult({ data: { hello: 'swapped' } }),
			}),
		});
		const answer = await app.gql('{ hello }');
		expect(answer.json.data.hello).toBe('swapped');
	});
});

describe('incremental delivery', () => {
	const counting = () => {
		const seen = { next: 0, end: 0 };
		start({
			onExecute: () => ({
				onExecuteDone: () => ({
					onNext: () => void seen.next++,
					onEnd: () => void seen.end++,
				}),
			}),
		});
		return seen;
	};

	test('onNext runs per @defer payload over multipart, then onEnd', async () => {
		const seen = counting();
		const response = await app.raw(DEFER, MULTIPART);
		const text = await response.text();
		expect(text).toContain('late');
		expect(seen.next).toBe(2);
		expect(seen.end).toBe(1);
	});

	test('the same over SSE', async () => {
		const seen = counting();
		const response = await app.raw(DEFER, SSE);
		expect(await response.text()).toContain('late');
		expect(seen.next).toBe(2);
		expect(seen.end).toBe(1);
	});
});

describe('@stream', () => {
	const letters = createSchema()({
		typeDefs: /* GraphQL */ `
			type Query {
				letters: [String!]!
			}
		`,
		resolvers: {
			Query: {
				letters: async function* () {
					for (const letter of ['a', 'b', 'c']) {
						await new Promise((r) => setTimeout(r, 5));
						yield letter;
					}
				},
			},
		},
	});
	const STREAM = '{ letters @stream(initialCount: 1) }';

	test('onNext sees the incremental payloads and setResult changes them', async () => {
		const seen: unknown[] = [];
		app = boot(
			[
				fromEnvelop([
					{
						onExecute: () => ({
							onExecuteDone: () => ({
								onNext: ({ result, setResult }: any) => {
									seen.push(structuredClone(result));
									if (result.incremental)
										setResult({
											...result,
											incremental: result.incremental.map((item: any) => ({
												...item,
												items: item.items?.map((x: string) => x.toUpperCase()),
											})),
										});
								},
							}),
						}),
					} as never,
				]),
			],
			{ schema: letters },
		);
		const text = await (await app.raw(STREAM, SSE)).text();
		expect(seen.length).toBeGreaterThan(1);
		expect(JSON.stringify(seen)).toContain('"a"');
		expect(text).toContain('"B"');
		expect(text).toContain('"C"');
		expect(text).not.toContain('"b"');
	});
});

describe('subscriptions', () => {
	const read = async (response: Response, needle: string) => {
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		let text = '';
		while (!text.includes(needle)) {
			const { value, done } = await reader.read();
			if (done) break;
			text += decoder.decode(value);
		}
		await reader.cancel();
		return text;
	};

	test('onSubscribeResult onNext sees each event and can replace it', async () => {
		start({
			onSubscribe: () => ({
				onSubscribeResult: () => ({
					onNext: ({ setResult, result }: any) =>
						setResult({ data: { tick: result.data.tick * 10 } }),
				}),
			}),
		});
		const response = await app.raw('subscription { tick }', SSE);
		await new Promise((r) => setTimeout(r, 50));
		await pubsub.publish('tick', 4);
		expect(await read(response, '"tick":40')).toContain('"tick":40');
	});

	test('onSubscribeResult onEnd runs when the client leaves', async () => {
		let ended = 0;
		start({
			onSubscribe: () => ({
				onSubscribeResult: () => ({ onEnd: () => void ended++ }),
			}),
		});
		const response = await app.raw('subscription { tick }', SSE);
		await new Promise((r) => setTimeout(r, 50));
		await pubsub.publish('tick', 1);
		await read(response, '"tick":1');
		await new Promise((r) => setTimeout(r, 100));
		expect(ended).toBe(1);
	});

	describe('onSubscribeError', () => {
		const failing = (subscribe: () => unknown) =>
			createSchema()({
				typeDefs: /* GraphQL */ `
					type Query {
						hello: String
					}
					type Subscription {
						tick: Int!
					}
				`,
				resolvers: {
					Query: { hello: () => 'world' },
					Subscription: {
						tick: { subscribe: subscribe as never, resolve: (n: number) => n },
					},
				},
			});
		const replacing = (schema: unknown) =>
			(app = boot(
				[
					fromEnvelop([
						{
							onSubscribe: () => ({
								onSubscribeError: ({ setError }: any) =>
									setError(new GraphQLError('replaced')),
							}),
						} as never,
					]),
				],
				{ schema: schema as never },
			));

		test('the hook receives the iteration error and its setError result is thrown', async () => {
			const received: unknown[] = [];
			app = boot(
				[
					fromEnvelop([
						{
							onSubscribe: () => ({
								onSubscribeError: ({ error, setError }: any) => {
									received.push(error.message);
									setError(new GraphQLError('replaced'));
								},
							}),
						} as never,
					]),
				],
				{
					schema: failing(async function* () {
						yield 1;
						throw new Error('iteration failed');
					}) as never,
				},
			);
			const text = await (await app.raw('subscription { tick }', SSE)).text();
			expect(received).toEqual(['iteration failed']);
			expect(text).toContain('"tick":1');
			expect(text).not.toContain('iteration failed');
		});

		// Suspected bug, not fixed here: the replaced GraphQLError is thrown from the
		// stream, and core masks every error thrown while iterating a subscription as
		// "Unexpected error." (even a plain GraphQLError with no Envelop plugin), so the
		// guide's "onSubscribeError can setError" never reaches the client.
		test.todo('the client sees the error set by onSubscribeError setError');

		test('an error of the initial subscribe goes through core, not the hook', async () => {
			replacing(
				failing(() => {
					throw new GraphQLError('initial failure');
				}),
			);
			const response = await app.raw('subscription { tick }', SSE);
			const text = await response.text();
			expect(text).toContain('initial failure');
			expect(text).not.toContain('replaced');
		});
	});
});
