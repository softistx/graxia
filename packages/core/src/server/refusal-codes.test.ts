import { describe, expect, test } from 'bun:test';
import { createGraxia } from './create-graxia';
import { schema } from './fixtures.test-util';

const graxia = createGraxia({
	schema,
	onUnexpected: false,
	limits: { bodyBytes: 100 },
	batching: true,
});
const json = { 'content-type': 'application/json', 'x-graphql-csrf': '1' };
const send = (init: RequestInit, url = 'http://x/graphql') =>
	graxia.fetch(new Request(url, init));
const post = (body: BodyInit, headers: HeadersInit = json) =>
	send({ method: 'POST', headers, body });

async function refused(res: Response, status: number, message: string) {
	expect(res.status).toBe(status);
	const body = (await res.json()) as {
		errors: { message: string; extensions: { code?: string; fix: string } }[];
	};
	expect(body.errors[0]?.message).toBe(message);
	expect(body.errors[0]?.extensions.fix).toBeString();
	return body.errors[0]?.extensions.code;
}

describe('HTTP-level refusals carry a stable extensions.code', () => {
	test('413 BODY_TOO_LARGE', async () => {
		const res = await post(`{"query":"{ hello }${' '.repeat(200)}"}`);
		expect(await refused(res, 413, 'The request body is too large.')).toBe(
			'BODY_TOO_LARGE',
		);
	});
	test('415 UNSUPPORTED_MEDIA_TYPE', async () => {
		const res = await post('{ hello }', {
			'content-type': 'text/plain',
			'x-graphql-csrf': '1',
		});
		expect(
			await refused(
				res,
				415,
				'The Content-Type must be application/json (UTF-8).',
			),
		).toBe('UNSUPPORTED_MEDIA_TYPE');
	});
	test('400 BODY_UNREADABLE (not UTF-8)', async () => {
		const res = await post(new Uint8Array([0xff, 0xfe, 0xfd]));
		expect(
			await refused(res, 400, 'The request body is not valid UTF-8.'),
		).toBe('BODY_UNREADABLE');
	});
	test('400 BODY_NOT_JSON', async () => {
		const res = await post('{nope');
		expect(await refused(res, 400, 'The request body is not valid JSON.')).toBe(
			'BODY_NOT_JSON',
		);
	});
	test('400 PARAMS_INVALID (POST and GET)', async () => {
		const post1 = await post('{"query":1}');
		expect(post1.status).toBe(400);
		const body = (await post1.json()) as {
			errors: { extensions: { code?: string } }[];
		};
		expect(body.errors[0]?.extensions.code).toBe('PARAMS_INVALID');
		const get = await send(
			{ headers: { 'x-graphql-csrf': '1' }, method: 'GET' },
			'http://x/graphql?query=%7B&variables=%7Bnope',
		);
		expect(get.status).toBe(400);
		const got = (await get.json()) as {
			errors: { extensions: { code?: string } }[];
		};
		expect(got.errors[0]?.extensions.code).toBe('PARAMS_INVALID');
	});
	test.each([
		['[]', 'BATCH_INVALID', 'A batch must hold at least one operation.'],
		[
			'[{"query":"{ hello }"},{"query":1}]',
			'BATCH_INVALID',
			'Batch entry 1: The "query" parameter must be a string.',
		],
	])('400 batch %#: %s', async (body, code, message) => {
		expect(await refused(await post(body), 400, message)).toBe(code);
	});
	test('400 BATCH_TOO_LARGE', async () => {
		const small = createGraxia({
			schema,
			onUnexpected: false,
			batching: { limit: 1 },
		});
		const res = await small.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: json,
				body: '[{"query":"{ hello }"},{"query":"{ hello }"}]',
			}),
		);
		expect(
			await refused(res, 400, 'A batch holds at most 1 operations, got 2.'),
		).toBe('BATCH_TOO_LARGE');
	});
	test('400 BATCHING_DISABLED', async () => {
		const off = createGraxia({ schema, onUnexpected: false });
		const res = await off.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: json,
				body: '[{"query":"{ hello }"}]',
			}),
		);
		expect(
			await refused(res, 400, 'Batching is not enabled on this server.'),
		).toBe('BATCHING_DISABLED');
	});
	test('400 BATCH_NOT_STREAMABLE', async () => {
		const res = await post('[{"query":"{ hello }"}]', {
			...json,
			accept: 'multipart/mixed',
		});
		expect(
			await refused(
				res,
				400,
				'Batched operations cannot be sent over multipart/mixed.',
			),
		).toBe('BATCH_NOT_STREAMABLE');
	});
	test('404 PATH_NOT_FOUND', async () => {
		expect(
			await refused(
				await send({ headers: json }, 'http://x/other'),
				404,
				'Not found.',
			),
		).toBe('PATH_NOT_FOUND');
	});
	test('405 METHOD_NOT_ALLOWED (method, and a mutation over GET)', async () => {
		expect(
			await refused(
				await send({ method: 'PUT', headers: json }),
				405,
				'Only GET and POST are allowed.',
			),
		).toBe('METHOD_NOT_ALLOWED');
		const get = await send(
			{
				headers: { 'x-graphql-csrf': '1' },
				method: 'GET',
			},
			`http://x/graphql?query=${encodeURIComponent('mutation { bump }')}`,
		);
		expect(get.status).toBe(405);
		const body = (await get.json()) as {
			errors: { extensions: { code?: string } }[];
		};
		expect(body.errors[0]?.extensions.code).toBe('METHOD_NOT_ALLOWED');
	});
	test('406 NOT_ACCEPTABLE', async () => {
		const res = await post('{"query":"{ hello }"}', {
			...json,
			accept: 'text/html',
		});
		expect(
			await refused(
				res,
				406,
				'The Accept header must allow application/graphql-response+json or application/json.',
			),
		).toBe('NOT_ACCEPTABLE');
	});
	test('WebSocket upgrade refusals: SUBPROTOCOL_REQUIRED, PATH_NOT_FOUND, METHOD_NOT_ALLOWED', async () => {
		const server = createGraxia({ schema, onUnexpected: false }).serve({
			port: 0,
		});
		try {
			const base = `http://localhost:${server.port}`;
			const upgrade = {
				upgrade: 'websocket',
				connection: 'Upgrade',
				'sec-websocket-version': '13',
				'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
			};
			const codeOf = async (res: Response) =>
				((await res.json()) as { errors: { extensions: { code?: string } }[] })
					.errors[0]?.extensions.code;
			expect(
				await codeOf(await fetch(`${base}/graphql`, { headers: upgrade })),
			).toBe('SUBPROTOCOL_REQUIRED');
			expect(
				await codeOf(await fetch(`${base}/other`, { headers: upgrade })),
			).toBe('PATH_NOT_FOUND');
			const { 'sec-websocket-key': _key, ...keyless } = upgrade;
			expect(
				await codeOf(
					await fetch(`${base}/graphql`, {
						headers: {
							...keyless,
							'sec-websocket-protocol': 'graphql-transport-ws',
						},
					}),
				),
			).toBe('UPGRADE_FAILED');
			expect(
				await codeOf(
					await fetch(`${base}/graphql`, { method: 'POST', headers: upgrade }),
				),
			).toBe('METHOD_NOT_ALLOWED');
		} finally {
			void server.stop(true);
		}
	});
	test('400 QUERY_REQUIRED', async () => {
		const res = await post('{}');
		expect(await refused(res, 400, 'Must provide a query string.')).toBe(
			'QUERY_REQUIRED',
		);
	});
});
