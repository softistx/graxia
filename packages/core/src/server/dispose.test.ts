import { describe, expect, mock, test } from 'bun:test';
import { GraxiaConfigError } from '../errors/config-error';
import { definePlugin } from '../plugins/define';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from './create-graxia';

const post = (query: string) =>
	new Request('http://localhost/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query }),
	});

function slowSchema() {
	let release!: () => void;
	let started!: () => void;
	const running = new Promise<void>((r) => {
		started = r;
	});
	const gate = new Promise<void>((r) => {
		release = r;
	});
	const schema = createSchema<Record<string, any>>()({
		typeDefs: 'type Query { slow: String stuck: String }',
		resolvers: {
			Query: {
				slow: async () => {
					started();
					await gate;
					return 'done';
				},
				stuck: (_r, _a, ctx) => {
					started();
					return new Promise<string>((resolve) =>
						ctx['signal'].addEventListener('abort', () => resolve('cancelled')),
					);
				},
			},
		},
	});
	return { schema, release, running };
}

describe('dispose', () => {
	test('new requests get 503 SHUTTING_DOWN while in-flight ones finish', async () => {
		const { schema, release, running } = slowSchema();
		const graxia = createGraxia({ schema });
		const inflight = graxia.fetch(post('{ slow }'));
		await running;
		const disposing = graxia.dispose();
		const refused = await graxia.fetch(post('{ slow }'));
		expect(refused.status).toBe(503);
		expect(refused.headers.get('connection')).toBe('close');
		expect(await refused.json()).toEqual({
			errors: [
				{
					message: 'Server is shutting down.',
					extensions: { code: 'SHUTTING_DOWN' },
				},
			],
		});
		release();
		expect(await (await inflight).json()).toEqual({ data: { slow: 'done' } });
		await disposing;
	});

	test('past the timeout the remaining operations are aborted', async () => {
		const { schema, running } = slowSchema();
		const graxia = createGraxia({ schema });
		const inflight = graxia.fetch(post('{ stuck }'));
		await running;
		await graxia.dispose({ timeout: 20 });
		const res = await inflight;
		expect(res.status).toBe(503);
		expect(await res.text()).toContain('OPERATION_ABORTED');
	});

	test('onDispose runs in reverse order, all of them, first error rethrown; idempotent', async () => {
		const order: string[] = [];
		const make = (name: string, fail = false) =>
			definePlugin()({
				name,
				onDispose: () => {
					order.push(name);
					if (fail) throw new Error(`${name} failed`);
				},
			});
		const { schema } = slowSchema();
		const graxia = createGraxia({
			schema,
			plugins: [make('a'), make('b', true), make('c', true)],
		});
		const first = graxia.dispose();
		expect(graxia.dispose()).toBe(first);
		await expect(first).rejects.toThrow('c failed');
		expect(order).toEqual(['c', 'b', 'a']);
	});

	test('stops servers started with serve()', async () => {
		const { schema } = slowSchema();
		const graxia = createGraxia({ schema });
		const server = graxia.serve({ port: 0 });
		await graxia.dispose();
		await expect(
			fetch(`http://localhost:${server.port}/graphql`),
		).rejects.toThrow();
	});

	test('supports await using', async () => {
		const { schema } = slowSchema();
		let ran = false;
		{
			await using graxia = createGraxia({
				schema,
				plugins: [
					definePlugin()({
						name: 'p',
						onDispose: () => {
							ran = true;
						},
					}),
				],
			});
			expect(graxia).toBeDefined();
		}
		expect(ran).toBe(true);
	});
});

describe('dispose edge cases', () => {
	test('an operation that ignores the signal is reported and does not block', async () => {
		const { schema } = slowSchema();
		const onUnexpected = mock();
		const stuck = definePlugin()({
			name: 'stuck',
			onExecute: ({ setExecuteFn }) =>
				setExecuteFn(() => new Promise(() => {})),
		});
		const graxia = createGraxia({ schema, onUnexpected, plugins: [stuck] });
		void graxia.fetch(post('{ slow }'));
		await Bun.sleep(10);
		await graxia.dispose({ timeout: 20 });
		expect(onUnexpected).toHaveBeenCalledTimes(1);
		expect(onUnexpected.mock.calls[0]?.[1]).toEqual({
			requestId: undefined,
			correlationId: undefined,
			phase: 'dispose',
		});
		expect(String(onUnexpected.mock.calls[0]?.[0])).toContain(
			'dispose: 1 operation(s) did not settle after abort',
		);
	});

	test('nothing stays in flight after a thrown hook, a short-circuit or a batch', async () => {
		const { schema } = slowSchema();
		const onUnexpected = mock();
		const plugin = definePlugin()({
			name: 'p',
			onRequest: ({ request, respond }) => {
				const q = new URL(request.url).searchParams;
				if (q.has('throw')) throw new Error('x');
				if (q.has('short')) respond(new Response('s'));
			},
		});
		const graxia = createGraxia({
			schema,
			onUnexpected,
			plugins: [plugin],
			batching: { limit: 2 },
		});
		await graxia.fetch(
			new Request('http://localhost/graphql?throw=1', { method: 'GET' }),
		);
		await graxia.fetch(
			new Request('http://localhost/graphql?short=1', { method: 'GET' }),
		);
		const batch = new Request('http://localhost/graphql', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify([
				{ query: '{ __typename }' },
				{ query: '{ __typename }' },
			]),
		});
		await graxia.fetch(batch);
		onUnexpected.mockClear();
		await graxia.dispose({ timeout: 20 });
		expect(onUnexpected).not.toHaveBeenCalled();
	});

	test('a request arriving while onDispose runs gets 503', async () => {
		const { schema } = slowSchema();
		let during: Response | undefined;
		let graxia!: ReturnType<typeof createGraxia>;
		graxia = createGraxia({
			schema,
			plugins: [
				definePlugin()({
					name: 'late',
					onDispose: async () => {
						during = await graxia.fetch(post('{ slow }'));
					},
				}),
			],
		});
		await graxia.dispose();
		expect(during?.status).toBe(503);
	});

	test('onDispose runs after an async setup finished', async () => {
		const { schema } = slowSchema();
		const order: string[] = [];
		const graxia = createGraxia({
			schema,
			plugins: [
				definePlugin()({
					name: 'slow-setup',
					setup: async () => {
						await Bun.sleep(30);
						order.push('setup');
					},
					onDispose: () => {
						order.push('dispose');
					},
				}),
			],
		});
		await graxia.dispose();
		expect(order).toEqual(['setup', 'dispose']);
	});

	test.each([-1, 1.5, Number.NaN])('shutdownTimeout %p throws', (value) => {
		const { schema } = slowSchema();
		expect(() => createGraxia({ schema, shutdownTimeout: value })).toThrow(
			GraxiaConfigError,
		);
	});
});
