import { describe, expect, test } from 'bun:test';
import { negotiate } from './negotiate';

describe('negotiate', () => {
	test('absent, empty and wildcard accept give application/json', () => {
		expect(negotiate(null)).toBe('application/json');
		expect(negotiate('')).toBe('application/json');
		expect(negotiate('*/*')).toBe('application/json');
		expect(negotiate('application/*')).toBe('application/json');
	});
	test('exact types', () => {
		expect(negotiate('application/json')).toBe('application/json');
		expect(negotiate('application/graphql-response+json')).toBe(
			'application/graphql-response+json',
		);
	});
	test('q-values and specificity decide', () => {
		expect(
			negotiate('application/json;q=0.5, application/graphql-response+json'),
		).toBe('application/graphql-response+json');
		expect(
			negotiate('application/graphql-response+json;q=0.2, application/json'),
		).toBe('application/json');
		expect(negotiate('*/*, application/graphql-response+json')).toBe(
			'application/graphql-response+json',
		);
		expect(negotiate('application/graphql-response+json;q=0, */*')).toBe(
			'application/json',
		);
	});
	test('unacceptable types give undefined', () => {
		expect(negotiate('text/html')).toBeUndefined();
		expect(negotiate('application/json;q=0')).toBeUndefined();
		expect(negotiate('text/event-stream, text/html')).toBeUndefined();
	});
});
