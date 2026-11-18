import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '../errors/config-error';
import { createStateKey, RequestState } from './state';

describe('RequestState', () => {
	test('set, get, has', () => {
		const key = createStateKey<number>('n');
		const state = new RequestState();
		expect(state.get(key)).toBeUndefined();
		state.set(key, 3);
		expect(state.get(key)).toBe(3);
		expect(state.has(key)).toBe(true);
	});

	test('keys with the same name are distinct', () => {
		const a = createStateKey<string>('user');
		const b = createStateKey<string>('user');
		const state = new RequestState();
		state.set(a, 'x');
		expect(state.get(b)).toBeUndefined();
	});

	test('require throws naming the key', () => {
		const state = new RequestState();
		const key = createStateKey<string>('tenant');
		expect(() => state.require(key)).toThrow(GraxiaConfigError);
		expect(() => state.require(key)).toThrow(/"tenant"/);
		state.set(key, 't');
		expect(state.require(key)).toBe('t');
	});
});
