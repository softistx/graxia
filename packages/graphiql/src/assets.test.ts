import { describe, expect, test } from 'bun:test';
import { fakeAssets, host } from './fixtures.test-util';
import { createGraphiQL } from './graphiql';

const app = host(createGraphiQL({ enabled: true }, fakeAssets));
const asset = (name: string, headers: HeadersInit = {}) =>
	app.fetch(
		new Request(`http://localhost/graphql?graphiql-asset=${name}`, { headers }),
	);

describe('assets', () => {
	test('serves a listed file with immutable caching and its type', async () => {
		const response = await asset('main-abc.js');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe(
			'text/javascript; charset=utf-8',
		);
		expect(response.headers.get('cache-control')).toBe(
			'public, max-age=31536000, immutable',
		);
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(await response.text()).toBe('console.log(1)');
		const css = await asset('main-abc.css');
		expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
	});

	test('serves the gzip variant when accepted', async () => {
		const response = await asset('main-abc.js', {
			'accept-encoding': 'br, gzip',
		});
		expect(response.headers.get('content-encoding')).toBe('gzip');
		expect(response.headers.get('vary')).toContain('accept-encoding');
		expect(await response.text()).toBe('GZ:console.log(1)');
	});

	test.each([
		'..%2Fpackage.json',
		'../package.json',
		'%2e%2e%2f',
		'/etc/passwd',
		'main-abc.js.gz',
		'manifest.json',
		'nope.js',
		'',
	])('refuses %p with 404', async (name) => {
		expect((await asset(name)).status).toBe(404);
	});

	test('an asset request needs no CSRF header, any Accept', async () => {
		expect((await asset('main-abc.css', { accept: '*/*' })).status).toBe(200);
	});
});
