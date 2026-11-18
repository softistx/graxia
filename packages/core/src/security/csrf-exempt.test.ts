import { describe, expect, test } from 'bun:test';
import { definePlugin } from '../plugins/define';
import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';

const page = () => new Response('page', { status: 200 });
const exempt = (request: Request) =>
	new URL(request.url).searchParams.has('page');

function instance(opts: {
	respond: boolean;
	csrfExempt?: (r: Request) => boolean;
}) {
	const errors: unknown[] = [];
	const graxia = createGraxia({
		schema,
		onUnexpected: (error) => {
			errors.push(error);
		},
		plugins: [
			definePlugin({
				name: 'exempting',
				csrfExempt: opts.csrfExempt ?? exempt,
				onRequest: opts.respond
					? ({ request, respond }) => {
							if (exempt(request)) respond(page());
						}
					: undefined,
			}),
		],
	});
	return { graxia, errors };
}
const get = (query: string, headers: HeadersInit = {}) =>
	new Request(`http://localhost/graphql?${query}`, { headers });

describe('plugin csrfExempt', () => {
	test('an exempt GET answered by a plugin skips the CSRF header check', async () => {
		const { graxia } = instance({ respond: true });
		const response = await graxia.fetch(get('page=1'));
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('page');
	});

	test('an exempt GET no plugin answers is refused 403 CSRF_HEADER_REQUIRED', async () => {
		const { graxia } = instance({ respond: false });
		const response = await graxia.fetch(
			get('page=1&query=%7B__typename%7D', { accept: 'application/json' }),
		);
		expect(response.status).toBe(403);
		const body = (await response.json()) as {
			errors: { extensions: { code: string } }[];
		};
		expect(body.errors[0]?.extensions.code).toBe('CSRF_HEADER_REQUIRED');
	});

	test('a request the predicate refuses keeps the check', async () => {
		const { graxia } = instance({ respond: true });
		const response = await graxia.fetch(get('query=%7B__typename%7D'));
		expect(response.status).toBe(403);
	});

	test('a POST is never exempt', async () => {
		const { graxia } = instance({ respond: true, csrfExempt: () => true });
		const response = await graxia.fetch(
			new Request('http://localhost/graphql?page=1', {
				method: 'POST',
				headers: { 'content-type': 'text/plain' },
				body: '{}',
			}),
		);
		expect(response.status).toBe(403);
	});

	test('the Origin check still applies to an exempt GET', async () => {
		const graxia = createGraxia({
			schema,
			csrf: { sameOrigin: true },
			plugins: [
				definePlugin({
					name: 'exempting',
					csrfExempt: () => true,
					onRequest: ({ respond }) => respond(page()),
				}),
			],
		});
		const response = await graxia.fetch(
			get('page=1', { origin: 'https://evil.example' }),
		);
		expect(response.status).toBe(403);
		const body = (await response.json()) as {
			errors: { extensions: { code: string } }[];
		};
		expect(body.errors[0]?.extensions.code).toBe('FORBIDDEN_ORIGIN');
	});

	test('a throwing predicate counts as false and is reported', async () => {
		const { graxia, errors } = instance({
			respond: true,
			csrfExempt: () => {
				throw new Error('boom');
			},
		});
		const response = await graxia.fetch(get('page=1'));
		expect(response.status).toBe(403);
		expect(errors).toHaveLength(1);
	});
});
