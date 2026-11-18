import { describe, expect, test } from 'bun:test';
import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';
import { DEFAULT_CSRF_HEADERS } from './options';

const q = encodeURIComponent('{ hello }');
const url = `http://localhost/graphql?query=${q}`;
const get = (headers: HeadersInit = {}) =>
	new Request(url, { headers: { accept: 'application/json', ...headers } });
const post = (contentType: string, headers: HeadersInit = {}) =>
	new Request('http://localhost/graphql', {
		method: 'POST',
		headers: {
			'content-type': contentType,
			accept: 'application/json',
			...headers,
		},
		body: JSON.stringify({ query: '{ hello }' }),
	});

describe('csrf requireHeader', () => {
	const graxia = createGraxia({ schema });

	test('a GET without a header is refused with the exact body', async () => {
		const response = await graxia.fetch(get());
		expect(response.status).toBe(403);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const { errors } = (await response.json()) as {
			errors: { message: string; extensions: Record<string, string> }[];
		};
		expect(errors).toHaveLength(1);
		expect(errors[0]?.message).toBe(
			'This request requires one of the headers x-graphql-csrf, graphql-require-preflight, apollo-require-preflight, x-apollo-operation-name (CSRF prevention).',
		);
		expect(errors[0]?.extensions['code']).toBe('CSRF_HEADER_REQUIRED');
		expect(errors[0]?.extensions['fix']).toContain('requireHeader: false');
	});

	test('the refusal uses the negotiated media type', async () => {
		const response = await graxia.fetch(
			get({ accept: 'application/graphql-response+json' }),
		);
		expect(response.status).toBe(403);
		expect(response.headers.get('content-type')).toContain(
			'application/graphql-response+json',
		);
	});

	test.each(DEFAULT_CSRF_HEADERS)('a GET with %s passes', async (name) => {
		const response = await graxia.fetch(get({ [name]: '1' }));
		expect(response.status).toBe(200);
	});

	test('an empty header value does not count', async () => {
		const response = await graxia.fetch(get({ 'x-graphql-csrf': '' }));
		expect(response.status).toBe(403);
	});

	test('a JSON POST passes without a header', async () => {
		for (const type of ['application/json', 'application/json; charset=utf-8'])
			expect((await graxia.fetch(post(type))).status).toBe(200);
		const media = await graxia.fetch(post('application/graphql-response+json'));
		expect(media.status).not.toBe(403);
	});

	test('text/plain, form and multipart POSTs are refused', async () => {
		for (const type of [
			'text/plain',
			'text/plain;charset=UTF-8',
			'application/x-www-form-urlencoded',
			'multipart/form-data; boundary=x',
		])
			expect((await graxia.fetch(post(type))).status).toBe(403);
		const bare = new Request('http://localhost/graphql', {
			method: 'POST',
			body: '{}',
		});
		bare.headers.delete('content-type');
		expect((await graxia.fetch(bare)).status).toBe(403);
	});

	test('a simple POST with a header gets past the check', async () => {
		const response = await graxia.fetch(
			post('text/plain', { 'x-graphql-csrf': '1' }),
		);
		expect(response.status).toBe(415);
	});

	test('an SSE GET is refused without a header and served with one', async () => {
		const sse = { accept: 'text/event-stream' };
		expect((await graxia.fetch(get(sse))).status).toBe(403);
		const ok = await graxia.fetch(get({ ...sse, 'x-graphql-csrf': '1' }));
		expect(ok.status).toBe(200);
		await ok.body?.cancel();
	});

	test('a custom list replaces the defaults', async () => {
		const custom = createGraxia({
			schema,
			csrf: { requireHeader: ['X-Custom'] },
		});
		expect((await custom.fetch(get({ 'x-graphql-csrf': '1' }))).status).toBe(
			403,
		);
		expect((await custom.fetch(get({ 'x-custom': '1' }))).status).toBe(200);
		const body = await (await custom.fetch(get())).json();
		expect(JSON.stringify(body)).toContain('headers x-custom (CSRF');
	});

	test('requireHeader: false and csrf: false turn it off', async () => {
		for (const csrf of [{ requireHeader: false }, false] as const)
			expect((await createGraxia({ schema, csrf }).fetch(get())).status).toBe(
				200,
			);
	});

	test('the refusal still runs onResponse and never reaches onRequest', async () => {
		const seen: string[] = [];
		const guarded = createGraxia({
			schema,
			plugins: [
				{
					name: 'spy',
					onRequest: () => void seen.push('request'),
					onResponse: ({ responseHeaders }) => {
						seen.push('response');
						responseHeaders.set('x-spy', '1');
					},
				},
			],
		});
		const response = await guarded.fetch(get());
		expect(response.status).toBe(403);
		expect(response.headers.get('x-spy')).toBe('1');
		expect(seen).toEqual(['response']);
	});

	test('graxia.execute is not checked', async () => {
		const result = await graxia.execute({ document: '{ hello }' });
		expect(result.data).toEqual({ hello: 'world' });
	});
});
