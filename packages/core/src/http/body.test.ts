import { describe, expect, test } from 'bun:test';
import { isJsonContentType, readBody } from './body';

const post = (body: BodyInit | null) =>
	new Request('http://x/graphql', { method: 'POST', body });

describe('readBody', () => {
	test('reads text under the limit', async () => {
		expect(await readBody(post('héllo'), 100)).toEqual({
			kind: 'text',
			text: 'héllo',
		});
	});
	test('no body is empty text', async () => {
		expect(await readBody(post(null), 100)).toEqual({ kind: 'text', text: '' });
	});
	test('exactly the limit passes, one byte more is too large', async () => {
		expect((await readBody(post('abcd'), 4)).kind).toBe('text');
		expect((await readBody(post('abcde'), 4)).kind).toBe('too-large');
	});
	test('a lying Content-Length does not hide a large stream', async () => {
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(new Uint8Array(10));
			},
		});
		const request = new Request('http://x/graphql', {
			method: 'POST',
			body: stream,
			headers: { 'content-length': '1' },
			duplex: 'half',
		} as RequestInit);
		expect((await readBody(request, 25)).kind).toBe('too-large');
	});
	test('an honest oversized Content-Length is refused before reading', async () => {
		const request = post('x'.repeat(50));
		expect((await readBody(request, 10)).kind).toBe('too-large');
	});
	test('invalid UTF-8 is invalid', async () => {
		const bytes = new Uint8Array([0xff, 0xfe, 0xfd]);
		expect((await readBody(post(bytes), 10)).kind).toBe('invalid');
	});
});

describe('isJsonContentType', () => {
	test.each([
		['application/json', true],
		['Application/JSON; charset=utf-8', true],
		['application/json; charset="UTF-8"', true],
		['application/json; charset=latin1', false],
		['text/plain', false],
		['application/graphql-response+json', false],
		[null, false],
	])('%s', (value, expected) => {
		expect(isJsonContentType(value)).toBe(expected);
	});
});

describe('readBody cancellation', () => {
	test('the source stream is cancelled once the limit is passed', async () => {
		let cancelled = false;
		let pulled = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled++;
				controller.enqueue(new Uint8Array(10));
			},
			cancel() {
				cancelled = true;
			},
		});
		const request = new Request('http://x/graphql', {
			method: 'POST',
			body: stream,
			duplex: 'half',
		} as RequestInit);
		expect((await readBody(request, 25)).kind).toBe('too-large');
		expect(cancelled).toBe(true);
		expect(pulled).toBeLessThan(10);
	});
});
