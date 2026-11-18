import { describe, expect, test } from 'bun:test';
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
