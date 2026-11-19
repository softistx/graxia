import { describe, expect, test } from 'bun:test';
import { createGraxia } from './create-graxia';
import {
	DEFER,
	MULTIPART,
	make,
	parts,
	post,
	schema,
} from './incremental.test-util';

describe('@defer over multipart/mixed', () => {
	test('initial, deferred and last payload parse with meros', async () => {
		const response = await make().fetch(post(DEFER, MULTIPART));
		expect(response.headers.get('content-type')).toBe(
			'multipart/mixed; boundary="-"',
		);
		const payloads = await parts(response);
		expect(payloads).toHaveLength(2);
		expect(payloads[0]).toMatchObject({
			data: { hello: 'world', user: { name: 'Ada' } },
			hasNext: true,
		});
		expect(payloads[0].pending).toHaveLength(1);
		expect(payloads[1]).toMatchObject({
			incremental: [{ data: { slow: 'late' } }],
			completed: [{ id: payloads[0].pending[0].id }],
			hasNext: false,
		});
	});

	test('raw framing: boundary "-" and the closing boundary', async () => {
		const response = await make().fetch(post(DEFER, MULTIPART));
		const text = await response.text();
		expect(text.startsWith('\r\n---\r\ncontent-type: application/json')).toBe(
			true,
		);
		expect(text.endsWith('\r\n-----\r\n')).toBe(true);
	});

	test('a query without @defer under multipart Accept is plain JSON', async () => {
		const response = await make().fetch(post('{ hello }', MULTIPART));
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({ data: { hello: 'world' } });
	});

	test('a validation error under multipart Accept is plain JSON', async () => {
		const response = await make().fetch(post('{ nope }', MULTIPART));
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(JSON.stringify(await response.json())).toContain('nope');
	});

	test('a batch is refused', async () => {
		const g = make({ batching: { limit: 2 } });
		const response = await g.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: MULTIPART },
				body: JSON.stringify([{ query: DEFER }]),
			}),
		);
		expect(response.status).toBe(400);
	});
});

describe('@stream', () => {
	test('initialCount 1 over an async generator', async () => {
		const response = await make().fetch(
			post('{ friends @stream(initialCount: 1) }', MULTIPART),
		);
		const payloads = await parts(response);
		expect(payloads[0].data).toEqual({ friends: ['ann'] });
		const items = payloads.flatMap((p) =>
			(p.incremental ?? []).flatMap((e: { items: string[] }) => e.items),
		);
		expect(items).toEqual(['bob', 'cat']);
		expect(payloads.at(-1).hasNext).toBe(false);
	});
});

describe('over server-sent events', () => {
	test('one next event per payload, then complete', async () => {
		const response = await make().fetch(post(DEFER, 'text/event-stream'));
		const text = await response.text();
		const events = text.split('\n\n').filter((e) => e.startsWith('event:'));
		expect(events.map((e) => e.split('\n')[0])).toEqual([
			'event: next',
			'event: next',
			'event: complete',
		]);
		const second = JSON.parse(
			(events[1] as string).split('data: ')[1] as string,
		);
		expect(second.incremental[0].data).toEqual({ slow: 'late' });
		expect(second.hasNext).toBe(false);
	});
});

describe('formats and options', () => {
	test('legacy format carries path and label', async () => {
		const response = await make({ incremental: { format: 'legacy' } }).fetch(
			post('{ user { name ... @defer(label: "L") { slow } } }', MULTIPART),
		);
		const payloads = await parts(response);
		expect(payloads[0]).toMatchObject({ hasNext: true });
		expect(payloads[0].pending).toBeUndefined();
		expect(payloads[1].incremental[0]).toMatchObject({
			data: { slow: 'late' },
			path: ['user'],
			label: 'L',
		});
	});

	test('an unknown format is a config error', () => {
		expect(() => make({ incremental: { format: 'x' as never } })).toThrow(
			'incremental.format',
		);
	});

	test('JSON Accept names the Accept to send', async () => {
		const response = await make().fetch(
			post(DEFER, 'application/graphql-response+json'),
		);
		expect(response.status).toBe(400);
		const body = JSON.stringify(await response.json());
		expect(body).toContain('INCREMENTAL_NOT_SUPPORTED');
		expect(body).toContain('multipart/mixed');
	});

	test('JSON listed before multipart/mixed (GraphiQL, Apollo) still streams @defer', async () => {
		const response = await make().fetch(
			post(DEFER, 'application/json, multipart/mixed'),
		);
		expect(response.headers.get('content-type')).toBe(
			'multipart/mixed; boundary="-"',
		);
		const payloads = await parts(response);
		expect(payloads).toHaveLength(2);
		expect(payloads[1]).toMatchObject({ hasNext: false });
	});

	test('a query that is not incremental keeps JSON under that Accept', async () => {
		const response = await make().fetch(
			post('{ hello }', 'application/json, multipart/mixed'),
		);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({ data: { hello: 'world' } });
	});

	test('incremental: false keeps the refusal, even over multipart', async () => {
		const response = await make({ incremental: false }).fetch(
			post(DEFER, 'text/event-stream'),
		);
		expect(await response.text()).toContain('INCREMENTAL_NOT_SUPPORTED');
	});

	test('createSchema adds the two directives; a custom schema lacks them', async () => {
		expect(schema.getDirective('defer')).toBeDefined();
		expect(schema.getDirective('stream')).toBeDefined();
		const { buildSchema } = await import('graphql');
		const bare = buildSchema('type Query { a: String }');
		const response = await createGraxia({ schema: bare }).fetch(
			post('{ ... @defer { a } }', 'application/json'),
		);
		expect(JSON.stringify(await response.json())).toContain(
			'Unknown directive',
		);
	});
});
