import { describe, expect, test } from 'bun:test';
import { parseBatch } from './batch';

describe('parseBatch', () => {
	test('refused when batching is off', () => {
		expect(parseBatch([{ query: '{ a }' }], false).ok).toBe(false);
	});
	test('accepts up to the limit', () => {
		const result = parseBatch([{ query: '{ a }' }, { query: '{ b }' }], {
			limit: 2,
		});
		expect(result).toEqual({
			ok: true,
			entries: [{ query: '{ a }' }, { query: '{ b }' }],
		});
	});
	test('refuses over the limit, empty, and invalid entries', () => {
		expect(parseBatch([{}, {}, {}], { limit: 2 }).ok).toBe(false);
		expect(parseBatch([], { limit: 2 }).ok).toBe(false);
		const bad = parseBatch([{ query: '{ a }' }, 'x'], { limit: 2 });
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.message).toContain('entry 1');
	});
});
