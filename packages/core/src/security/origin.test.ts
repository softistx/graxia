import { describe, expect, test } from 'bun:test';
import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';

const request = (headers: HeadersInit, post = true) =>
	post
		? new Request('http://app.test/graphql', {
				method: 'POST',
				headers: { 'content-type': 'application/json', ...headers },
				body: JSON.stringify({ query: '{ hello }' }),
			})
		: new Request('http://app.test/graphql?query=%7Bhello%7D', {
				headers: { 'x-graphql-csrf': '1', ...headers },
			});

const status = async (
	csrf: Parameters<typeof createGraxia>[0]['csrf'],
	headers: HeadersInit,
	post = true,
) =>
	(
		await createGraxia({
			schema,
			...(csrf === undefined ? {} : { csrf }),
		}).fetch(request(headers, post))
	).status;

describe('csrf sameOrigin', () => {
	const on = { sameOrigin: true } as const;

	test('same origin, no Origin, and an allowed origin pass', async () => {
		expect(await status(on, { origin: 'http://app.test' })).toBe(200);
		expect(await status(on, {})).toBe(200);
		const allowed = {
			sameOrigin: { allowedOrigins: ['https://web.example.com'] },
		};
		expect(await status(allowed, { origin: 'https://web.example.com' })).toBe(
			200,
		);
	});

	test('a cross origin is refused with the exact body', async () => {
		const response = await createGraxia({ schema, csrf: on }).fetch(
			request({ origin: 'https://evil.test' }),
		);
		expect(response.status).toBe(403);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const { errors } = (await response.json()) as {
			errors: { message: string; extensions: Record<string, string> }[];
		};
		expect(errors[0]?.message).toBe(
			'Cross-origin request refused from https://evil.test.',
		);
		expect(errors[0]?.extensions['code']).toBe('FORBIDDEN_ORIGIN');
		expect(errors[0]?.extensions['fix']).toContain(
			'csrf.sameOrigin.allowedOrigins',
		);
	});

	test('a null origin is always refused, even with crossOrigin: allow', async () => {
		const open = { sameOrigin: { crossOrigin: 'allow' } } as const;
		for (const csrf of [on, open]) {
			const response = await createGraxia({
				schema,
				...(csrf === undefined ? {} : { csrf }),
			}).fetch(request({ origin: 'null' }));
			expect(response.status).toBe(403);
			expect(JSON.stringify(await response.json())).toContain(
				'Cross-origin request refused from a null origin.',
			);
		}
	});

	test('crossOrigin refuse, json and allow', async () => {
		const origin = { origin: 'https://other.test' };
		const mode = (crossOrigin: 'refuse' | 'json' | 'allow') => ({
			sameOrigin: { crossOrigin },
		});
		expect(await status(mode('refuse'), origin)).toBe(403);
		expect(await status(mode('allow'), origin)).toBe(200);
		expect(await status(mode('json'), origin)).toBe(200);
		// a GET is simple: refused under json unless it carries a custom header (it does here)
		const bareGet = new Request('http://app.test/graphql?query=%7Bhello%7D', {
			headers: origin,
		});
		const json = createGraxia({
			schema,
			csrf: { requireHeader: false, sameOrigin: { crossOrigin: 'json' } },
		});
		expect((await json.fetch(bareGet)).status).toBe(403);
		const withHeader = createGraxia({
			schema,
			csrf: { sameOrigin: { crossOrigin: 'json' } },
		});
		expect((await withHeader.fetch(request(origin, false))).status).toBe(200);
	});

	test('Sec-Fetch-Site: cross-site without Origin is a cross origin', async () => {
		const site = { 'sec-fetch-site': 'cross-site' };
		expect(await status(on, site)).toBe(403);
		expect(await status(on, { 'sec-fetch-site': 'same-origin' })).toBe(200);
		expect(await status({ sameOrigin: { crossOrigin: 'allow' } }, site)).toBe(
			200,
		);
	});

	test('Sec-Fetch-Site: same-site without Origin fails closed; same-origin and none pass', async () => {
		expect(await status(on, { 'sec-fetch-site': 'same-site' })).toBe(403);
		expect(await status(on, { 'sec-fetch-site': 'none' })).toBe(200);
		expect(await status(on, { 'sec-fetch-site': 'same-origin' })).toBe(200);
	});

	test('it is off by default and with csrf: false', async () => {
		const origin = { origin: 'https://evil.test' };
		expect(await status(undefined, origin)).toBe(200);
		expect(await status(false, origin)).toBe(200);
	});
});

describe('WebSocket upgrade origin', () => {
	const upgrade = async (
		csrf: Parameters<typeof createGraxia>[0]['csrf'],
		headers: HeadersInit,
		extra: Partial<Parameters<typeof createGraxia>[0]> = {},
	) => {
		const graxia = createGraxia({
			schema,
			...(csrf === undefined ? {} : { csrf }),
			...extra,
		});
		let upgraded = false;
		const server = {
			upgrade: () => {
				upgraded = true;
				return true;
			},
		};
		const response = await graxia.upgrade(
			new Request('http://app.test/graphql', {
				headers: {
					upgrade: 'websocket',
					'sec-websocket-protocol': 'graphql-transport-ws',
					...headers,
				},
			}),
			server as never,
		);
		return { response, upgraded };
	};

	test('a cross origin is refused with 403 before the upgrade, with sameOrigin off', async () => {
		const { response, upgraded } = await upgrade(undefined, {
			origin: 'https://evil.test',
		});
		expect(response?.status).toBe(403);
		expect(response?.headers.get('cache-control')).toBe('no-store');
		expect(upgraded).toBe(false);
	});

	test('same origin, an allowed origin and no Origin pass', async () => {
		expect(
			(await upgrade(undefined, { origin: 'http://app.test' })).upgraded,
		).toBe(true);
		expect((await upgrade(undefined, {})).upgraded).toBe(true);
		const allowed = { sameOrigin: { allowedOrigins: ['https://web.test'] } };
		expect(
			(await upgrade(allowed, { origin: 'https://web.test' })).upgraded,
		).toBe(true);
	});

	test('null is refused, crossOrigin allow and json do not open it', async () => {
		expect(
			(await upgrade(undefined, { origin: 'null' })).response?.status,
		).toBe(403);
		for (const crossOrigin of ['allow', 'json'] as const) {
			const csrf = { sameOrigin: { crossOrigin } };
			const { response } = await upgrade(csrf, {
				origin: 'https://evil.test',
			});
			expect(response?.status).toBe(403);
		}
	});

	test('csrf: false turns the check off', async () => {
		const { upgraded } = await upgrade(false, { origin: 'https://evil.test' });
		expect(upgraded).toBe(true);
	});
});
