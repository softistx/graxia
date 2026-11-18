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

describe('fork', () => {
	const key = createStateKey<string>('k');
	test('reads fall through to the parent, writes stay local', () => {
		const parent = new RequestState();
		parent.set(key, 'parent');
		const child = parent.fork();
		expect(child.get(key)).toBe('parent');
		expect(child.has(key)).toBe(true);
		expect(child.require(key)).toBe('parent');
		child.set(key, 'child');
		expect(child.get(key)).toBe('child');
		expect(parent.get(key)).toBe('parent');
	});
	test('siblings are isolated and share responseHeaders', () => {
		const parent = new RequestState();
		const a = parent.fork();
		const b = parent.fork();
		a.set(key, 'a');
		expect(b.has(key)).toBe(false);
		expect(() => b.require(key)).toThrow();
		a.responseHeaders.set('x-a', '1');
		expect(parent.responseHeaders.get('x-a')).toBe('1');
		expect(b.responseHeaders).toBe(parent.responseHeaders);
	});
});
