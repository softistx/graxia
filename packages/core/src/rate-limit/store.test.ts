import { describe, expect, test } from 'bun:test';
import { limitFromStore, memoryFieldLimit } from './store';

describe('memoryFieldLimit', () => {
	test('spends, refuses over the limit, and resets with the window', () => {
		let now = 1000;
		const limit = memoryFieldLimit({ limit: 3, windowMs: 100, now: () => now });
		expect(limit.consume('k', 2)).toEqual({ allowed: true, retryAfter: 0 });
		expect(limit.consume('k', 2)).toEqual({ allowed: false, retryAfter: 100 });
		expect(limit.consume('k', 1)).toEqual({ allowed: true, retryAfter: 0 });
		now = 1060;
		expect(limit.consume('k', 1)).toEqual({ allowed: false, retryAfter: 40 });
		now = 1100;
		expect(limit.consume('k', 3)).toEqual({ allowed: true, retryAfter: 0 });
	});
	test('keys are independent', () => {
		const limit = memoryFieldLimit({ limit: 1, windowMs: 100 });
		expect(limit.consume('a', 1)).toMatchObject({ allowed: true });
		expect(limit.consume('b', 1)).toMatchObject({ allowed: true });
	});
	test('the map is capped: expired first, then the oldest', () => {
		let now = 0;
		const limit = memoryFieldLimit({
			limit: 1,
			windowMs: 100,
			maxKeys: 2,
			now: () => now,
		});
		limit.consume('a', 1);
		now = 50;
		limit.consume('b', 1);
		now = 120; // a expired
		limit.consume('c', 1);
		expect(limit.consume('b', 1)).toMatchObject({ allowed: false });
		limit.consume('d', 1); // evicts the oldest (b)
		expect(limit.consume('b', 1)).toMatchObject({ allowed: true });
	});
	test('a full map evicts only the oldest entry between sweeps', () => {
		let now = 0;
		const limit = memoryFieldLimit({
			limit: 1,
			windowMs: 100,
			maxKeys: 2,
			now: () => now,
		});
		limit.consume('a', 1);
		limit.consume('b', 1);
		now = 10;
		limit.consume('c', 1); // no sweep yet (swept at 0): evicts a
		expect(limit.consume('b', 1)).toMatchObject({ allowed: false });
		expect(limit.consume('a', 1)).toMatchObject({ allowed: true });
	});
	test('rejects bad options', () => {
		expect(() => memoryFieldLimit({ limit: 0, windowMs: 1 })).toThrow(
			'memoryFieldLimit: limit must be an integer of 1 or more',
		);
		expect(() => memoryFieldLimit({ limit: 1, windowMs: 1.5 })).toThrow(
			'memoryFieldLimit: windowMs must be an integer of 1 or more',
		);
		expect(() =>
			memoryFieldLimit({ limit: 1, windowMs: 1, maxKeys: 0 }),
		).toThrow('memoryFieldLimit: maxKeys must be an integer of 1 or more');
	});
});

describe('limitFromStore', () => {
	const store = (allowFor: number) => {
		const calls: unknown[] = [];
		return {
			calls,
			policy: { limit: 5, windowMs: 1000 },
			consume(key: string, policy: { limit: number; windowMs: number }) {
				calls.push([key, policy]);
				return calls.length <= allowFor
					? { allowed: true, retryAfter: 0 }
					: { allowed: false, retryAfter: 700 };
			},
		};
	};
	test('one store call per unit, stopped at the first refusal', async () => {
		const s = store(2);
		const decision = await limitFromStore(s).consume('k', 5);
		expect(decision).toEqual({ allowed: false, retryAfter: 700 });
		expect(s.calls).toHaveLength(3);
		expect(s.calls[0]).toEqual(['k', { limit: 5, windowMs: 1000 }]);
	});
	test('allowed when every unit passes', async () => {
		expect(await limitFromStore(store(9)).consume('k', 3)).toEqual({
			allowed: true,
			retryAfter: 0,
		});
	});
	test('a cost over the limit is one call and a refusal', async () => {
		const s = store(99);
		expect(await limitFromStore(s).consume('k', 1_000_000_000)).toEqual({
			allowed: false,
			retryAfter: 1000,
		});
		expect(s.calls).toHaveLength(1);
		const refusing = store(0);
		expect(await limitFromStore(refusing).consume('k', 6)).toEqual({
			allowed: false,
			retryAfter: 700,
		});
		expect(refusing.calls).toHaveLength(1);
	});
	test('a cost that is not finite is refused without a call', async () => {
		const s = store(99);
		expect(
			await limitFromStore(s).consume('k', Number.POSITIVE_INFINITY),
		).toMatchObject({
			allowed: false,
		});
		expect(s.calls).toHaveLength(0);
	});
	test('the policy may come from the argument alone', () => {
		const { policy: _p, ...bare } = store(1);
		expect(() =>
			limitFromStore(bare, { limit: 2, windowMs: 10 }),
		).not.toThrow();
	});
	test('config errors', () => {
		const { policy: _p, ...bare } = store(1);
		expect(() => limitFromStore(bare)).toThrow(
			'limitFromStore: no policy; pass { limit, windowMs } or give the store a policy',
		);
		expect(() => limitFromStore(store(1), { limit: 6 })).toThrow(
			"limitFromStore: limit 6 differs from the store policy's limit 5",
		);
		expect(() => limitFromStore(bare, { limit: 0, windowMs: 10 })).toThrow(
			'limitFromStore: limit must be an integer of 1 or more',
		);
		expect(() => limitFromStore(bare, { limit: 1, windowMs: 0.5 })).toThrow(
			'limitFromStore: windowMs must be an integer of 1 or more',
		);
	});
});
