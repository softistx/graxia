import { describe, expect, test } from 'bun:test';
import { browser, fakeAssets, host } from './fixtures.test-util';
import { createGraphiQL } from './graphiql';
import { createApolloSandbox, sandboxContentSecurityPolicy } from './sandbox';

const on = (options = {}, instance: Record<string, unknown> = {}) =>
	host(
		createApolloSandbox({ enabled: true, ...options }, fakeAssets),
		instance,
	);
const noWs = { subscriptions: { ws: false } };
const configOf = (html: string) =>
	JSON.parse(
		(/data-config="([^"]*)"/.exec(html)?.[1] ?? '')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&amp;/g, '&'),
	);

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
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		const html = await response.text();
		expect(html).toContain('<div id="sandbox"');
		expect(html).toContain(
			'<script src="https://embeddable-sandbox.cdn.apollographql.com/v2/embeddable-sandbox.umd.production.min.js"></script>',
		);
		expect(html).toContain(
			'type="module" src="?apollo-sandbox-asset=sandbox-abc.js"',
		);
	});

	test('no inline script, no inline style, no SRI on a moving URL', async () => {
		const html = await (await on().fetch(browser())).text();
		expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
		expect(html).not.toMatch(/<style|\sstyle=|\sonload=|integrity=/);
	});

	test('the CSP names the exact Apollo hosts and nothing else', async () => {
		const csp = (await on({}, noWs).fetch(browser())).headers.get(
			'content-security-policy',
		);
		expect(csp).toBe(sandboxContentSecurityPolicy());
		expect(csp).toBe(
			"default-src 'none'; script-src 'self' https://embeddable-sandbox.cdn.apollographql.com; style-src 'self' 'unsafe-inline'; img-src data:; connect-src 'self'; frame-src https://sandbox.embed.apollographql.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
		);
		expect(csp).not.toMatch(/\*|script-src[^;]*unsafe-|ws:|wss:/);
	});

	test('a WebSocket instance adds the same-host ws origin and tells the bootstrap', async () => {
		const response = await on().fetch(browser());
		expect(response.headers.get('content-security-policy')).toContain(
			"connect-src 'self' ws://localhost;",
		);
		expect(configOf(await response.text()).subscriptions).toBe(true);
	});

	test('an SSE-only instance has no subscriptions in the Sandbox', async () => {
		const response = await on(
			{},
			{ subscriptions: { ws: false, sse: true } },
		).fetch(browser());
		expect(response.headers.get('content-security-policy')).not.toContain(
			'ws:',
		);
		expect(configOf(await response.text()).subscriptions).toBe(false);
	});

	test('the initial state defaults to no cookies and is passed through', async () => {
		expect(
			configOf(await (await on({}, noWs).fetch(browser())).text()),
		).toEqual({
			title: 'Apollo Sandbox',
			subscriptions: false,
			initialState: { includeCookies: false },
		});
		const state = {
			document: '{ hello }',
			variables: { a: 1 },
			headers: { 'x-tenant': 'demo' },
			includeCookies: true,
		};
		const config = configOf(
			await (
				await on({ title: 'Mine', initialState: state }).fetch(browser())
			).text(),
		);
		expect(config).toEqual({
			title: 'Mine',
			subscriptions: true,
			initialState: state,
		});
	});

	test('the config is attribute-escaped', async () => {
		const title = `</script><b a="1" & '>`;
		const html = await (
			await on({
				title,
				initialState: { document: `{ "x": "</script>" }` },
			}).fetch(browser())
		).text();
		expect(html).not.toContain('</script><b');
		expect(html).toContain('&lt;/script&gt;');
		expect(configOf(html).title).toBe(title);
		expect(configOf(html).initialState.document).toBe(`{ "x": "</script>" }`);
	});
});

describe('bootstrap asset', () => {
	const asset = (name: string) =>
		on().fetch(
			new Request(`http://localhost/graphql?apollo-sandbox-asset=${name}`),
		);

	test('serves the listed bootstrap with immutable caching', async () => {
		const response = await asset('sandbox-abc.js');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe(
			'text/javascript; charset=utf-8',
		);
		expect(response.headers.get('cache-control')).toBe(
			'public, max-age=31536000, immutable',
		);
		expect(await response.text()).toBe('sandbox()');
	});

	test.each(['../x', 'nope.js', '%2e%2e', 'constructor'])(
		'refuses %p with 404',
		async (name) => {
			expect((await asset(name)).status).toBe(404);
		},
	);
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

	test('a text/html GET with a query is not the page', async () => {
		expect((await on().fetch(browser('?query=%7Bhello%7D'))).status).toBe(403);
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
});

describe('enabled', () => {
	test('enabled: false serves nothing', async () => {
		const plugin = createApolloSandbox({ enabled: false }, fakeAssets);
		expect(plugin.onRequest).toBeUndefined();
		expect(plugin.csrfExempt).toBeUndefined();
		expect((await host(plugin).fetch(browser())).status).toBe(403);
	});

	test('a disabled plugin is named apart, so it never counts as installed', () => {
		expect(createApolloSandbox({ enabled: false }, fakeAssets).name).toBe(
			'apollo-sandbox (disabled)',
		);
		expect(createGraphiQL({ enabled: false }, fakeAssets).name).toBe(
			'graphiql (disabled)',
		);
	});

	test('production disables it by default, true enables it', () => {
		const before = process.env['NODE_ENV'];
		process.env['NODE_ENV'] = 'production';
		try {
			expect(createApolloSandbox({}, fakeAssets).onRequest).toBeUndefined();
			expect(
				createApolloSandbox({ enabled: true }, fakeAssets).onRequest,
			).toBeDefined();
		} finally {
			if (before === undefined) delete process.env['NODE_ENV'];
			else process.env['NODE_ENV'] = before;
		}
	});
});

describe('with graphiql()', () => {
	const both = (graphiql: boolean, sandbox: boolean) =>
		host(createApolloSandbox({ enabled: sandbox }, fakeAssets), {
			plugins: [
				createGraphiQL({ enabled: graphiql }, fakeAssets),
				createApolloSandbox({ enabled: sandbox }, fakeAssets),
			],
		});

	test('two enabled explorers are refused at startup, either order', async () => {
		const sandbox = createApolloSandbox({ enabled: true }, fakeAssets);
		const graphiql = createGraphiQL({ enabled: true }, fakeAssets);
		for (const plugins of [
			[graphiql, sandbox],
			[sandbox, graphiql],
		])
			await expect(host(graphiql, { plugins }).ready).rejects.toThrow(
				/graphiql\(\) and apolloSandbox\(\) are both enabled/,
			);
	});

	test('a disabled one is not installed: the other answers', async () => {
		expect(await (await both(true, false).fetch(browser())).text()).toContain(
			'id="graphiql"',
		);
		expect(await (await both(false, true).fetch(browser())).text()).toContain(
			'id="sandbox"',
		);
	});
});
