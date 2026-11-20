import { describe, expect, test } from 'bun:test';
import {
	acceptsMultipart,
	negotiate,
	prefersEventStream,
	prefersMultipart,
	readAccept,
} from './negotiate';

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

describe('prefersEventStream', () => {
	test('only a named text/event-stream with q above 0 counts', () => {
		expect(prefersEventStream(null)).toBe(false);
		expect(prefersEventStream('*/*')).toBe(false);
		expect(prefersEventStream('application/json')).toBe(false);
		expect(prefersEventStream('text/event-stream')).toBe(true);
		expect(prefersEventStream('text/event-stream;q=0')).toBe(false);
	});
	test('q-values and order decide against the JSON types', () => {
		expect(prefersEventStream('text/event-stream, application/json')).toBe(
			true,
		);
		expect(prefersEventStream('application/json, text/event-stream')).toBe(
			false,
		);
		expect(
			prefersEventStream('application/json;q=0.5, text/event-stream'),
		).toBe(true);
		expect(
			prefersEventStream('text/event-stream;q=0.5, application/json'),
		).toBe(false);
		expect(prefersEventStream('text/event-stream, */*;q=0.8')).toBe(true);
	});
});

describe('prefersMultipart', () => {
	test('named multipart/mixed (parameters ignored) before JSON wins', () => {
		expect(
			prefersMultipart('multipart/mixed;deferSpec=20220824, application/json'),
		).toBe(true);
		expect(prefersMultipart('multipart/mixed')).toBe(true);
	});
	test('never through a wildcard, absent, q=0, or after a JSON type', () => {
		expect(prefersMultipart(null)).toBe(false);
		expect(prefersMultipart('*/*')).toBe(false);
		expect(prefersMultipart('multipart/mixed;q=0')).toBe(false);
		expect(prefersMultipart('application/json, multipart/mixed')).toBe(false);
	});
});

describe('acceptsMultipart', () => {
	test('named at any rank with a q above 0, never through a wildcard', () => {
		expect(acceptsMultipart('application/json, multipart/mixed')).toBe(true);
		expect(acceptsMultipart('multipart/mixed;deferSpec=20220824')).toBe(true);
		expect(acceptsMultipart(null)).toBe(false);
		expect(acceptsMultipart('*/*')).toBe(false);
		expect(acceptsMultipart('application/json, multipart/mixed;q=0')).toBe(
			false,
		);
	});
});

describe('readAccept', () => {
	const headers = [
		null,
		'',
		'*/*',
		'application/*',
		'application/json',
		'application/graphql-response+json, application/json',
		'application/json;q=0.5, application/graphql-response+json',
		'text/event-stream',
		'text/event-stream, application/json',
		'application/json, text/event-stream',
		'multipart/mixed',
		'application/json, multipart/mixed',
		'multipart/mixed;q=0, application/json',
		'text/html',
		'application/json;q=0',
	];
	const expected = (h: string | null) => ({
		eventStream: prefersEventStream(h),
		multipart: prefersMultipart(h),
		acceptsMultipart: acceptsMultipart(h),
		media: negotiate(h),
	});
	test('equals the four functions, first and memoised', () => {
		for (const h of [...headers, ...headers])
			expect({ ...readAccept(h) }).toEqual(expected(h));
	});
	test('the same text gives the same reading', () => {
		expect(readAccept('application/json')).toBe(readAccept('application/json'));
	});
	test('stays right past the bound of 64 distinct headers', () => {
		for (let i = 0; i < 200; i++) {
			const h = `text/x-${i}, application/json;q=0.${(i % 9) + 1}`;
			expect({ ...readAccept(h) }).toEqual(expected(h));
		}
		expect({ ...readAccept('application/json') }).toEqual(
			expected('application/json'),
		);
	});
	test('a 300-character header answers right and is not stored', () => {
		const h = `${'x/y, '.repeat(60)}text/event-stream`;
		expect(h.length).toBeGreaterThan(256);
		expect({ ...readAccept(h) }).toEqual(expected(h));
		expect(readAccept(h)).not.toBe(readAccept(h));
	});
});
