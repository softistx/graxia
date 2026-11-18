import { describe, expect, test } from 'bun:test';
import { truncateReason } from './socket';

describe('truncateReason', () => {
	test('keeps a short reason', () => {
		expect(truncateReason('Going away')).toBe('Going away');
	});

	test('cuts ASCII at 123 bytes', () => {
		expect(truncateReason('a'.repeat(200))).toHaveLength(123);
	});

	test('counts UTF-8 bytes and never splits a character', () => {
		const cut = truncateReason('é'.repeat(100)); // 2 bytes each
		expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(123);
		expect(cut).toBe('é'.repeat(61));
		const emoji = truncateReason('😀'.repeat(40)); // 4 bytes each
		expect(emoji).toBe('😀'.repeat(30));
	});
});
