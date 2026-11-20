import { describe, expect, test } from 'bun:test';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from './create-graxia';

const seen = { signal: undefined as AbortSignal | undefined };
let calls = 0;

const schema = createSchema<Record<string, any>>()({
	typeDefs: 'type Query { hello: String wait: String }',
	resolvers: {
		Query: {
			hello: () => {
				calls++;
				return 'world';
			},
			wait: (_r, _a, ctx) => {
				seen.signal = ctx['signal'];
				ctx['started']?.();
				// Ignores the signal: execute must still answer.
				return new Promise<string>((resolve) =>
					setTimeout(resolve, 2000, 'late'),
				);
			},
		},
	},
});

const quiet = { onUnexpected: false } as const;

describe('graxia.execute with an aborted signal', () => {
	test('aborted before the call: resolves with OPERATION_ABORTED, runs no resolver', async () => {
		calls = 0;
		const graxia = createGraxia({ schema, ...quiet });
		const result = await graxia.execute({
			document: '{ hello }',
			signal: AbortSignal.abort(),
		});
		expect(result.data).toBeUndefined();
		expect(result.errors).toHaveLength(1);
		expect(result.errors?.[0]?.message).toBe('The operation was aborted.');
		expect(result.errors?.[0]?.extensions?.['code']).toBe('OPERATION_ABORTED');
		expect(calls).toBe(0);
	});

	test('aborted while a resolver runs: resolves, and the context signal aborts', async () => {
		seen.signal = undefined;
		const controller = new AbortController();
		const graxia = createGraxia({
			schema,
			...quiet,
			context: () => ({
				started: () => queueMicrotask(() => controller.abort()),
			}),
		});
		const started = Date.now();
		const result = await graxia.execute({
			document: '{ wait }',
			signal: controller.signal,
		});
		expect(result.data).toBeUndefined();
		expect(result.errors?.[0]?.extensions?.['code']).toBe('OPERATION_ABORTED');
		expect((seen.signal as AbortSignal | undefined)?.aborted).toBe(true);
		// Does not wait for a resolver that ignores the signal.
		expect(Date.now() - started).toBeLessThan(1000);
	});

	test('a signal that never aborts changes nothing', async () => {
		const graxia = createGraxia({ schema, ...quiet });
		const result = await graxia.execute({
			document: '{ hello }',
			signal: new AbortController().signal,
		});
		expect(result).toEqual({ data: { hello: 'world' } });
	});
});
