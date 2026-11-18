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
	test('an explicit q=0 beats a wildcard', () => {
		expect(negotiate('application/json;q=0, */*')).toBe(
			'application/graphql-response+json',
		);
		expect(
			negotiate(
				'application/json;q=0, application/graphql-response+json;q=0, */*',
			),
		).toBeUndefined();
		expect(negotiate('*/*, application/json;q=0')).toBe(
			'application/graphql-response+json',
		);
	});
	test('q is clamped to 0..1', () => {
		expect(
			negotiate('application/graphql-response+json;q=7, application/json;q=1'),
		).toBe('application/graphql-response+json');
		expect(negotiate('application/json;q=-3')).toBeUndefined();
		expect(negotiate('application/json;q=abc')).toBeUndefined();
	});
	test('the first listed of two exact types wins a tie', () => {
		expect(
			negotiate('application/json, application/graphql-response+json'),
		).toBe('application/json');
		expect(
			negotiate('application/graphql-response+json, application/json'),
		).toBe('application/graphql-response+json');
	});
});
