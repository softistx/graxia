import { describe, expect, test } from 'bun:test';
import { createRequestId, requestIdKey } from './request-id';

describe('request id', () => {
	test('ids are unique UUIDs', () => {
		const a = createRequestId();
		expect(a).toMatch(/^[0-9a-f-]{36}$/);
		expect(createRequestId()).not.toBe(a);
	});
	test('the state key is named', () => {
		expect(requestIdKey.name).toBe('request-id');
	});
});
