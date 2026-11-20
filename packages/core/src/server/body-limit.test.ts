import { describe, expect, test } from 'bun:test';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from './create-graxia';

const schema = createSchema()({
	typeDefs: 'type Query { hello: String }',
	resolvers: { Query: { hello: () => 'world' } },
});
const graxia = createGraxia({
	schema,
	onUnexpected: false,
	limits: { bodyBytes: 100 },
});
const headers = { 'content-type': 'application/json' };
const send = (body: BodyInit, extra: HeadersInit = {}) =>
	graxia.fetch(
		new Request('http://x/graphql', {
			method: 'POST',
			headers: { ...headers, ...extra },
			body,
			duplex: 'half',
		} as RequestInit),
		{},
	);
const chunks = (list: Uint8Array[]) => {
	const queue = [...list];
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			const next = queue.shift();
			if (next === undefined) controller.close();
			else controller.enqueue(next);
		},
	});
};

describe('limits.bodyBytes', () => {
	test('(a) a Content-Length over the limit answers 413', async () => {
		const res = await send(
			JSON.stringify({ query: `{ hello }${' '.repeat(200)}` }),
		);
		expect(res.status).toBe(413);
		const body = JSON.stringify(await res.json());
		expect(body).toContain('The request body is too large.');
		expect(body).toContain('"code":"BODY_TOO_LARGE"');
	});
	test('(b) a chunked body growing past the limit answers 413', async () => {
		const piece = new TextEncoder().encode(' '.repeat(40));
		const head = new TextEncoder().encode('{"query":"{ hello }');
		const res = await send(chunks([head, piece, piece, piece, piece]));
		expect(res.status).toBe(413);
		const body = JSON.stringify(await res.json());
		expect(body).toContain('The request body is too large.');
		expect(body).toContain('"code":"BODY_TOO_LARGE"');
	});
	test('(c) a body stream that errors mid-read answers 400', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"query":'));
				controller.error(new Error('host limit'));
			},
		});
		const res = await send(body);
		expect(res.status).toBe(400);
		const text = JSON.stringify(await res.json());
		expect(text).toContain('The request body could not be read.');
		expect(text).toContain('"code":"BODY_UNREADABLE"');
	});
});
