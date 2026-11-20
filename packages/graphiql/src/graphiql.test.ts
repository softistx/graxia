import { describe, expect, test } from 'bun:test';
import { definePlugin } from '@graxia/core';
import { browser, fakeAssets, host } from './fixtures.test-util';
import { createGraphiQL } from './graphiql';

const on = (options = {}) =>
	host(createGraphiQL({ enabled: true, ...options }, fakeAssets));

describe('page', () => {
	test('a browser GET gets the page with its security headers', async () => {
		const response = await on().fetch(browser());
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe(
			'text/html; charset=utf-8',
		);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-frame-options')).toBe('DENY');
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
		const html = await response.text();
		expect(html).toContain('<div id="graphiql"');
		expect(html).toContain('href="?graphiql-asset=main-abc.css"');
		expect(html).toContain('type="module" src="?graphiql-asset=main-abc.js"');
		expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
	});

	test('the CSP has no external source', async () => {
		const csp =
			(
				await host(createGraphiQL({ enabled: true }, fakeAssets), {
					subscriptions: { ws: false },
				}).fetch(browser())
			).headers.get('content-security-policy') ?? '';
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("script-src 'self'");
		expect(csp).toContain("style-src 'self' 'unsafe-inline'");
		expect(csp).toContain("connect-src 'self'");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).not.toMatch(/https?:\/\//);
		expect(csp).not.toContain('ws');
	});

	test('ws subscriptions add the same-host ws origin to connect-src', async () => {
		const csp = (
			await on({ subscriptions: 'ws' }).fetch(browser())
		).headers.get('content-security-policy');
		expect(csp).toContain("connect-src 'self' ws://localhost");
	});

	test('the config is attribute-escaped', async () => {
		const title = `</script><b a="1" & '>`;
		const html = await (
			await on({ title, defaultQuery: `{ "x": "</script>" }` }).fetch(browser())
		).text();
		expect(html).not.toContain('</script><b');
		expect(html).toContain('&lt;/script&gt;');
		expect(html).toContain('&quot;');
		const config = /data-config="([^"]*)"/.exec(html)?.[1] ?? '';
		const decoded = config
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&amp;/g, '&');
		expect(JSON.parse(decoded).title).toBe(title);
		expect(JSON.parse(decoded).defaultQuery).toBe(`{ "x": "</script>" }`);
	});

	test('the page has no absolute URL', async () => {
		const html = await (await on().fetch(browser())).text();
		expect(html).not.toMatch(/(?:src|href|action)=["']?(?:https?:)?\/\//);
	});

	test('core responseHeaders still merge into the page', async () => {
		const app = host(createGraphiQL({ enabled: true }, fakeAssets), {
			plugins: [
				definePlugin({
					name: 'probe',
					onRequest: ({ responseHeaders }) => {
						responseHeaders.set('x-probe', 'kept');
					},
				}),
				createGraphiQL({ enabled: true }, fakeAssets),
			],
		});
		const response = await app.fetch(browser());
		expect(response.status).toBe(200);
		expect(response.headers.get('x-probe')).toBe('kept');
	});
});

describe('requests that are not the page', () => {
	test('a JSON GET with a query still executes', async () => {
		const response = await on().fetch(
			new Request('http://localhost/graphql?query=%7Bhello%7D', {
				headers: { accept: 'application/json', 'x-graphql-csrf': '1' },
			}),
		);
		expect(await response.json()).toEqual({ data: { hello: 'world' } });
	});

	test('a text/html GET with a query is not the page, and keeps the CSRF check', async () => {
		const response = await on().fetch(browser('?query=%7Bhello%7D'));
		expect(response.status).toBe(403);
	});

	test('a POST still executes', async () => {
		const response = await on().fetch(
			new Request('http://localhost/graphql', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json',
				},
				body: JSON.stringify({ query: '{ hello }' }),
			}),
		);
		expect(await response.json()).toEqual({ data: { hello: 'world' } });
	});

	test('the page works with CSRF and introspection defaults (no header)', async () => {
		const response = await host(createGraphiQL({ enabled: true }, fakeAssets), {
			introspection: true,
		}).fetch(browser());
		expect(response.status).toBe(200);
	});
});

describe('disabled', () => {
	test('enabled: false serves nothing: core answers as usual', async () => {
		const plugin = createGraphiQL({ enabled: false }, fakeAssets);
		expect(plugin.onRequest).toBeUndefined();
		expect(plugin.csrfExempt).toBeUndefined();
		const response = await host(plugin).fetch(browser());
		expect(response.status).toBe(403);
	});

	test('production disables it by default, true enables it', () => {
		const before = process.env['NODE_ENV'];
		process.env['NODE_ENV'] = 'production';
		try {
			expect(createGraphiQL({}, fakeAssets).onRequest).toBeUndefined();
			expect(
				createGraphiQL({ enabled: true }, fakeAssets).onRequest,
			).toBeDefined();
		} finally {
			if (before === undefined) delete process.env['NODE_ENV'];
			else process.env['NODE_ENV'] = before;
		}
	});
});

describe('enabled as a function', () => {
	const seen: Request[] = [];
	const allow = (answer: boolean) => (request: Request) => {
		seen.push(request);
		return answer;
	};

	test('true serves the page, and is called with the Request', async () => {
		seen.length = 0;
		const response = await host(
			createGraphiQL({ enabled: allow(true) }, fakeAssets),
		).fetch(browser());
		expect(response.status).toBe(200);
		expect(seen.length).toBeGreaterThan(0);
		expect(seen[0]).toBeInstanceOf(Request);
		expect(seen.every((request) => request === seen[0])).toBe(true);
	});

	test('false falls through like a disabled explorer', async () => {
		const response = await host(
			createGraphiQL({ enabled: allow(false) }, fakeAssets),
		).fetch(browser());
		expect(response.status).toBe(403);
	});

	test('false also refuses the assets', async () => {
		const response = await host(
			createGraphiQL({ enabled: () => false }, fakeAssets),
		).fetch(browser('?graphiql-asset=main-abc.js'));
		expect(response.status).toBe(403);
	});

	test('is decided for each request', async () => {
		let open = false;
		const app = host(createGraphiQL({ enabled: () => open }, fakeAssets));
		expect((await app.fetch(browser())).status).toBe(403);
		open = true;
		expect((await app.fetch(browser())).status).toBe(200);
		open = false;
		expect((await app.fetch(browser())).status).toBe(403);
	});

	test('is not called for a request the explorer would not answer', async () => {
		seen.length = 0;
		const app = host(createGraphiQL({ enabled: allow(true) }, fakeAssets));
		await app.fetch(
			new Request('http://localhost/graphql', { method: 'POST', body: '{}' }),
		);
		expect(seen).toHaveLength(0);
	});

	test('an async function never opens it: only `true` serves', async () => {
		const enabled = (async () => true) as never;
		const response = await host(createGraphiQL({ enabled }, fakeAssets)).fetch(
			browser(),
		);
		expect(response.status).toBe(403);
	});

	test('a function that throws: 403 without the CSRF header, masked 500 with it', async () => {
		const reported: unknown[] = [];
		const app = host(
			createGraphiQL(
				{
					enabled: () => {
						throw new Error('flag store down');
					},
				},
				fakeAssets,
			),
			{ onUnexpected: (error: unknown) => reported.push(error) },
		);
		expect((await app.fetch(browser())).status).toBe(403);
		expect(reported).toHaveLength(1);
		const withHeader = await app.fetch(browser('', { 'x-graphql-csrf': '1' }));
		expect(withHeader.status).toBe(500);
		expect(await withHeader.text()).not.toContain('flag store down');
	});

	test('another value is a config error naming the accepted forms', () => {
		expect(() =>
			createGraphiQL({ enabled: 'yes' as never }, fakeAssets),
		).toThrow(/boolean or a function.*enabled: \(\) => myDevFlag/s);
	});
});
