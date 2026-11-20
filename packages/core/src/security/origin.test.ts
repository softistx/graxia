import { describe, expect, mock, test } from 'bun:test';
import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';
import type { CsrfOptions } from './options';

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

	describe('onRefused', () => {
		type Handler = NonNullable<
			NonNullable<Exclude<CsrfOptions['sameOrigin'], boolean>>['onRefused']
		>;
		const make = (
			onRefused: unknown,
			extra: Record<string, unknown> = {},
			options: Record<string, unknown> = {},
		) =>
			createGraxia({
				schema,
				csrf: { sameOrigin: { onRefused, ...extra } } as never,
				...options,
			});
		const answer = (
			onRefused: unknown,
			headers: HeadersInit,
			extra: Record<string, unknown> = {},
		) => make(onRefused, extra).fetch(request(headers));
		const evil = { origin: 'https://evil.test' };
		const upgradeOf = (
			graxia: ReturnType<typeof createGraxia>,
			headers: HeadersInit,
		) => {
			let upgraded = false;
			const response = graxia.upgrade(
				new Request('http://app.test/graphql', {
					headers: {
						upgrade: 'websocket',
						'sec-websocket-protocol': 'graphql-transport-ws',
						...headers,
					},
				}),
				{
					upgrade: () => {
						upgraded = true;
						return true;
					},
				} as never,
			);
			return { response, upgraded: () => upgraded };
		};

		test('a custom status and body replace the default 403', async () => {
			const response = await answer(
				() => new Response('not here', { status: 404 }),
				evil,
			);
			expect(response.status).toBe(404);
			expect(await response.text()).toBe('not here');
		});

		test('an async onRefused is awaited', async () => {
			const response = await answer(async () => {
				await Promise.resolve();
				return Response.json({ nope: true }, { status: 418 });
			}, evil);
			expect(response.status).toBe(418);
			expect(await response.json()).toEqual({ nope: true });
		});

		test('it gets the request, the reason and websocket: false of each refusal', async () => {
			const seen: unknown[] = [];
			const onRefused: Handler = (req, info) => {
				seen.push([info.reason, info.websocket, req.headers.get('origin')]);
				return new Response(null, { status: 404 });
			};
			await answer(onRefused, evil);
			await answer(onRefused, { origin: 'null' });
			await answer(onRefused, { 'sec-fetch-site': 'cross-site' });
			expect(seen).toEqual([
				['cross-origin', false, 'https://evil.test'],
				['null-origin', false, 'null'],
				['no-origin', false, null],
			]);
		});

		test('same-site without Origin is no-origin', async () => {
			const seen: string[] = [];
			await answer(
				(_req: Request, info: { reason: string }) => {
					seen.push(info.reason);
					return undefined;
				},
				{ 'sec-fetch-site': 'same-site' },
			);
			expect(seen).toEqual(['no-origin']);
		});

		test('returning undefined, or a non-Response, gives the default 403', async () => {
			for (const result of [undefined, null, { status: 404 }, 'nope']) {
				const response = await answer(() => result, evil);
				expect(response.status).toBe(403);
				expect(JSON.stringify(await response.json())).toContain(
					'FORBIDDEN_ORIGIN',
				);
			}
			const asyncDefault = await answer(async () => undefined, evil);
			expect(asyncDefault.status).toBe(403);
		});

		test('it is not called for an allowed request, and the default stays without it', async () => {
			let calls = 0;
			const onRefused = () => {
				calls++;
				return new Response(null, { status: 404 });
			};
			const allowed = { allowedOrigins: ['https://web.test'] };
			expect(
				(await answer(onRefused, { origin: 'https://web.test' }, allowed))
					.status,
			).toBe(200);
			expect(calls).toBe(0);
			const plain = await createGraxia({
				schema,
				csrf: { sameOrigin: allowed },
			}).fetch(request(evil));
			expect(plain.status).toBe(403);
			expect(JSON.stringify(await plain.json())).toContain('FORBIDDEN_ORIGIN');
		});

		test('crossOrigin json refuses a simple request through it', async () => {
			let reason = '';
			const simple = new Request('http://app.test/graphql?query=%7Bhello%7D', {
				headers: evil,
			});
			// requireHeader off so the GET is a simple request the origin check refuses
			const graxia = createGraxia({
				schema,
				csrf: {
					requireHeader: false,
					sameOrigin: {
						crossOrigin: 'json',
						onRefused: (_req: Request, info: { reason: string }) => {
							reason = info.reason;
							return new Response(null, { status: 404 });
						},
					},
				},
			});
			expect((await graxia.fetch(simple)).status).toBe(404);
			expect(reason).toBe('cross-origin');
		});

		test('no-store is added, an existing cache-control is kept', async () => {
			const added = await answer(
				() => new Response('x', { status: 404 }),
				evil,
			);
			expect(added.headers.get('cache-control')).toBe('no-store');
			const kept = await answer(
				() =>
					new Response('x', {
						status: 404,
						headers: { 'cache-control': 'max-age=60' },
					}),
				evil,
			);
			expect(kept.headers.get('cache-control')).toBe('max-age=60');
		});

		test('a throwing or rejecting onRefused is a 500 reported once', async () => {
			for (const onRefused of [
				() => {
					throw new Error('boom');
				},
				async () => {
					throw new Error('boom');
				},
			]) {
				const onUnexpected = mock();
				const graxia = make(onRefused, {}, { onUnexpected });
				const response = await graxia.fetch(request(evil));
				expect(response.status).toBe(500);
				expect(onUnexpected).toHaveBeenCalledTimes(1);
				const socket = mock();
				const upgrade = make(onRefused, {}, { onUnexpected: socket });
				const { response: refused, upgraded } = upgradeOf(upgrade, evil);
				expect((await refused)?.status).toBe(500);
				expect(socket).toHaveBeenCalledTimes(1);
				expect(upgraded()).toBe(false);
			}
		});

		test('it answers a refused WebSocket upgrade, async too, with websocket: true', async () => {
			const seen: unknown[] = [];
			const graxia = make(async (_req: Request, info: unknown) => {
				seen.push(info);
				return new Response(null, { status: 404 });
			});
			const { response, upgraded } = upgradeOf(graxia, evil);
			expect((await response)?.status).toBe(404);
			expect(upgraded()).toBe(false);
			expect(seen).toEqual([{ reason: 'cross-origin', websocket: true }]);
		});
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
