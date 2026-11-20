import { afterEach, describe, expect, test } from 'bun:test';
import { type App, createApp } from './app';

const apps: App[] = [];
const start = (options: Parameters<typeof createApp>[0] = {}) => {
	const app = createApp({ shutdownTimeout: 2_000, ...options });
	apps.push(app);
	return app;
};
afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.stop()));
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const JSON_TYPE = { 'content-type': 'application/json' };

const post = (
	app: App,
	query: string,
	headers: Record<string, string> = {},
	path = '/api/graphql',
) =>
	fetch(app.url + path, {
		method: 'POST',
		headers: { ...JSON_TYPE, ...headers },
		body: JSON.stringify({ query }),
	});

/** Reads an event stream until `done(text)` holds or it ends. */
async function readEvents(response: Response, done: (text: string) => boolean) {
	const reader = response.body?.getReader();
	const decoder = new TextDecoder();
	let text = '';
	while (reader) {
		const { value, done: ended } = await reader.read();
		if (ended) break;
		text += decoder.decode(value);
		if (done(text)) {
			await reader.cancel();
			break;
		}
	}
	return text;
}

/** A raw graphql-transport-ws client: its messages in a queue. */
function socket(app: App) {
	const ws = new WebSocket(
		`${app.url.replace('http', 'ws')}/api/graphql`,
		'graphql-transport-ws',
	);
	const queue: any[] = [];
	const waiting: ((message: any) => void)[] = [];
	ws.addEventListener('message', (event) => {
		const message = JSON.parse(String(event.data));
		const waiter = waiting.shift();
		if (waiter) waiter(message);
		else queue.push(message);
	});
	const closed = new Promise<number>((resolve) =>
		ws.addEventListener('close', (event) => resolve(event.code)),
	);
	const opened = new Promise<void>((resolve) =>
		ws.addEventListener('open', () => resolve()),
	);
	return {
		ws,
		closed,
		send: async (message: unknown) => {
			await opened;
			ws.send(JSON.stringify(message));
		},
		next: (): Promise<any> =>
			queue.length > 0
				? Promise.resolve(queue.shift())
				: new Promise((resolve) => waiting.push(resolve)),
	};
}

describe('the host owns the server', () => {
	test('serves graphql under the prefix', async () => {
		const app = start();
		const get = await fetch(
			`${app.url}/api/graphql?query=${encodeURIComponent('{ hello }')}`,
			{ headers: { 'x-graphql-csrf': '1' } },
		);
		expect(await get.json()).toEqual({ data: { hello: 'world' } });
		expect(await (await post(app, '{ hello }')).json()).toEqual({
			data: { hello: 'world' },
		});
		expect((await post(app, '{ hello }', {}, '/graphql')).status).toBe(404);
		expect((await fetch(`${app.url}/health`)).status).toBe(200);
	});

	test('the host context reaches resolvers', async () => {
		const app = start();
		const asAda = await post(app, '{ me }', { 'x-user': 'ada' });
		expect(await asAda.json()).toEqual({ data: { me: 'ada' } });
		const anonymous = await post(app, '{ me }');
		expect(await anonymous.json()).toEqual({ data: { me: null } });
	});

	test('a resolver sets a cookie and a header', async () => {
		const app = start();
		const response = await post(app, 'mutation { login(name: "ada") }');
		expect(await response.json()).toEqual({ data: { login: true } });
		expect(response.headers.get('cache-control')).toBe('no-store');
		const [cookie] = response.headers.getSetCookie();
		expect(cookie).toContain('session=ada');
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('SameSite=Lax');
		expect(response.headers.get('content-type')).toContain('json');
	});

	test("CORS is the host's", async () => {
		const origin = 'https://app.example';
		const app = start({ origins: [origin] });
		const preflight = await fetch(`${app.url}/api/graphql`, {
			method: 'OPTIONS',
			headers: {
				origin,
				'access-control-request-method': 'POST',
				'access-control-request-headers': 'content-type',
			},
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
		expect(preflight.headers.get('access-control-allow-headers')).toContain(
			'x-graphql-csrf',
		);
		const allowed = await post(app, '{ hello }', { origin });
		expect(allowed.headers.get('access-control-allow-origin')).toBe(origin);
		expect(allowed.headers.get('vary')).toContain('origin');
		const other = await post(app, '{ hello }', {
			origin: 'https://other.example',
		});
		expect(other.status).toBe(200);
		expect(other.headers.get('access-control-allow-origin')).toBeNull();
	});
});

describe('streams on the same path', () => {
	test('graphql-ws on the same path', async () => {
		const app = start();
		const client = socket(app);
		await client.send({ type: 'connection_init', payload: { token: 't' } });
		expect((await client.next()).type).toBe('connection_ack');
		await client.send({
			id: '1',
			type: 'subscribe',
			payload: { query: 'subscription { ticks(every: 10) }' },
		});
		expect(await client.next()).toMatchObject({
			type: 'next',
			payload: { data: { ticks: 1 } },
		});
		expect(await client.next()).toMatchObject({
			type: 'next',
			payload: { data: { ticks: 2 } },
		});
		await client.send({ id: '1', type: 'complete' });
		client.ws.close();
		expect(await client.closed).toBe(1005);
	});

	test('SSE on the same path', async () => {
		const app = start();
		const response = await post(app, 'subscription { ticks(every: 10) }', {
			accept: 'text/event-stream',
		});
		expect(response.headers.get('content-type')).toContain('text/event-stream');
		const text = await readEvents(
			response,
			(seen) => seen.split('event: next').length > 2,
		);
		expect(text).toContain('"ticks":1');
		expect(text).toContain('"ticks":2');
	});
});

describe('shutdown', () => {
	test('stop() drains', async () => {
		const app = start();
		const inflight = post(app, '{ slow(ms: 200) }');
		const stream = await post(app, 'subscription { ticks(every: 20) }', {
			accept: 'text/event-stream',
		});
		const reading = readEvents(stream, () => false);
		const client = socket(app);
		await client.send({ type: 'connection_init' });
		expect((await client.next()).type).toBe('connection_ack');
		await client.send({
			id: '1',
			type: 'subscribe',
			payload: { query: 'subscription { ticks(every: 20) }' },
		});
		await client.next();
		await sleep(30);

		const stopping = app.stop();
		expect(app.stop()).toBe(stopping);
		const late = await post(app, '{ hello }');
		expect(late.status).toBe(503);
		expect(JSON.stringify(await late.json())).toContain('SHUTTING_DOWN');
		expect((await fetch(`${app.url}/ready`)).status).toBe(503);

		const answered = await inflight;
		expect(answered.status).toBe(200);
		expect(await answered.json()).toEqual({ data: { slow: 200 } });
		expect(await reading).toContain('event: complete');
		expect(await client.closed).toBe(1001);
		await stopping;
	});
});
