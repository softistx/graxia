import { describe, expect, test } from 'bun:test';
import {
	type Body,
	build,
	byId,
	codes,
	post,
	type Reported,
} from './profile/profile.test-util';

const reported: Reported = [];
const graxia = build('production', reported);

describe('production profile: introspection and suggestions', () => {
	test('__schema and __type are refused', async () => {
		for (const id of ['schema', 'type'] as const) {
			const { response, body } = await byId(graxia, id);
			expect(response.status).toBe(200);
			expect(codes(body)).toEqual(['GRAPHQL_VALIDATION_FAILED']);
		}
	});

	test('__typename stays allowed', async () => {
		const { response, body } = await byId(graxia, 'typename');
		expect(response.status).toBe(200);
		expect(body.data).toEqual({ __typename: 'Query' });
	});

	test('a validation error carries no "Did you mean"', async () => {
		const { body } = await byId(graxia, 'typo');
		expect(codes(body)).toEqual(['GRAPHQL_VALIDATION_FAILED']);
		expect(JSON.stringify(body)).not.toContain('Did you mean');
	});
});

describe('production profile: errors', () => {
	test('an unexpected resolver error is masked and reported', async () => {
		const before = reported.length;
		const { response, body } = await byId(graxia, 'boom');
		const text = JSON.stringify(body);
		expect(response.status).toBe(200);
		expect(body.errors?.[0]?.message).toBe('Unexpected error.');
		expect(codes(body)).toEqual(['INTERNAL_SERVER_ERROR']);
		expect(text).not.toContain('secret detail');
		expect(text).not.toContain('originalError');
		expect(text).not.toContain('stack');
		expect(reported.length).toBe(before + 1);
		expect(reported.at(-1)?.phase).toBe('execution');
		expect(String(reported.at(-1)?.error)).toBe('Error: secret detail');
	});
});

describe('production profile: CSRF and origins', () => {
	test('a GET without a preflight header is refused with 403', async () => {
		const response = await graxia.fetch(
			new Request('http://app.test/graphql?query=%7Bhello%7D', {
				headers: { accept: 'application/json' },
			}),
		);
		expect(response.status).toBe(403);
	});

	test('a JSON POST passes', async () => {
		const { response, body } = await byId(graxia, 'hello');
		expect(response.status).toBe(200);
		expect(body.data).toEqual({ hello: 'world' });
	});

	test('a WebSocket upgrade from another origin is refused', async () => {
		let upgraded = false;
		const server = { upgrade: () => (upgraded = true) };
		const response = await graxia.upgrade(
			new Request('http://app.test/graphql', {
				headers: {
					upgrade: 'websocket',
					'sec-websocket-protocol': 'graphql-transport-ws',
					origin: 'https://evil.test',
				},
			}),
			server as never,
		);
		expect(response?.status).toBe(403);
		expect(upgraded).toBe(false);
	});
});

describe('production profile: limits', () => {
	test.each([
		['deep', 'depth'],
		['aliases', 'aliases'],
		['cost', 'cost'],
	] as const)(
		'the %s document is refused by the %s limit',
		async (id, name) => {
			const { response, body } = await byId(graxia, id);
			expect(response.status).toBe(200);
			expect(body.errors?.[0]?.extensions?.['limit']?.name).toBe(name);
		},
	);

	test('a document over the token limit is refused', async () => {
		const { response, body } = await byId(graxia, 'tokens');
		expect(response.status).toBe(200);
		expect(codes(body)).toEqual(['GRAPHQL_PARSE_FAILED']);
	});

	test('a body over 1 MiB answers 413', async () => {
		const response = await post(graxia, {
			documentId: 'hello',
			variables: { pad: 'x'.repeat(1_048_577) },
		});
		expect(response.status).toBe(413);
	});
});

describe('production profile: trusted documents', () => {
	test('an arbitrary query is refused PERSISTED_QUERY_ONLY', async () => {
		const response = await post(graxia, { query: '{ hello }' });
		const body = (await response.json()) as Body;
		expect(response.status).toBe(400);
		expect(codes(body)).toEqual(['PERSISTED_QUERY_ONLY']);
	});

	test('an APQ registration is refused', async () => {
		const sha256Hash = new Bun.CryptoHasher('sha256')
			.update('{ boom }')
			.digest('hex');
		const response = await post(graxia, {
			query: '{ boom }',
			extensions: { persistedQuery: { version: 1, sha256Hash } },
		});
		const body = (await response.json()) as Body;
		expect(codes(body)).toEqual(['PERSISTED_QUERY_NOT_SUPPORTED']);
	});
});

describe('production profile: requests', () => {
	test('batching is off', async () => {
		const response = await post(graxia, [{ documentId: 'hello' }]);
		expect(response.status).toBe(400);
	});

	test('the request id is generated, never the client header', async () => {
		const { response } = await byId(graxia, 'hello');
		const sent = await post(
			graxia,
			{ documentId: 'hello' },
			{ 'x-request-id': 'client-chosen' },
		);
		expect(sent.headers.get('x-request-id')).not.toBe('client-chosen');
		expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
	});
});

describe('production profile: rate limit and telemetry', () => {
	test('fieldRateLimit answers 429 with Retry-After', async () => {
		const limited = build('production');
		expect((await byId(limited, 'signIn')).response.status).toBe(200);
		const { response, body } = await byId(limited, 'signIn');
		expect(response.status).toBe(429);
		expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
		expect(codes(body)).toEqual(['RATE_LIMITED']);
	});

	test('the no-op tracer path leaves the response unchanged', async () => {
		const withOtel = await byId(build('production'), 'hello');
		expect(withOtel.body).toEqual({ data: { hello: 'world' } });
		expect(withOtel.response.headers.get('content-type')).toContain(
			'application/json',
		);
	});
});
