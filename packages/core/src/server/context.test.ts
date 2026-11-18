import { describe, expect, mock, test } from 'bun:test';
import { GraxiaConfigError } from '../errors/config-error';
import { definePlugin } from '../plugins/define';
import { createSchema } from '../schema/create-schema';
import { getContext, tryGetContext } from './context';
import { createGraxia } from './create-graxia';

const post = (body: unknown, signal?: AbortSignal) =>
	new Request('http://localhost/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
		...(signal ? { signal } : {}),
	});

const seen: object[] = [];
const schema = createSchema<Record<string, any>>()({
	typeDefs: `type Query { me: String ctx: String wait: String }`,
	resolvers: {
		Query: {
			me: (_r, _a, ctx) => {
				seen.push(ctx);
				return String(ctx['user'] ?? ctx['tenant']);
			},
			ctx: (_r, _a, ctx) =>
				String(getContext<Record<string, unknown>>() === ctx),
			wait: (_r, _a, ctx) =>
				new Promise<string>((resolve) => {
					ctx['signal'].addEventListener('abort', () => {
						ctx['sawAbort']?.();
						resolve('aborted');
					});
					ctx['started']?.();
				}),
		},
	},
});

describe('context building', () => {
	test('serverContext, then context(), then onContext', async () => {
		const plugin = definePlugin()({
			name: 'add',
			onContext: () => ({ user: 'from-plugin' }),
		});
		const graxia = createGraxia<{ tenant: string }>({
			schema,
			plugins: [plugin],
			context: ({ serverContext }) => ({ tenant: `${serverContext.tenant}!` }),
		});
		const res = await graxia.fetch(post({ query: '{ me }' }), { tenant: 'a' });
		expect(await res.json()).toEqual({ data: { me: 'from-plugin' } });
		const last = seen.at(-1) as Record<string, unknown>;
		expect(last['tenant']).toBe('a!');
		expect(last['signal']).toBeInstanceOf(AbortSignal);
	});

	test('a plugin cannot replace the signal', async () => {
		seen.length = 0;
		const graxia = createGraxia({
			schema,
			plugins: [
				definePlugin()({ name: 'evil', onContext: () => ({ signal: 'nope' }) }),
			],
		});
		await graxia.fetch(post({ query: '{ me }' }));
		expect((seen[0] as any).signal).toBeInstanceOf(AbortSignal);
	});

	test('context receives the signal', async () => {
		let got: AbortSignal | undefined;
		const graxia = createGraxia({
			schema,
			context: ({ signal }) => {
				got = signal;
				return {};
			},
		});
		await graxia.fetch(post({ query: '{ me }' }));
		expect(got).toBeInstanceOf(AbortSignal);
	});

	test('each batch entry has its own context and signal', async () => {
		seen.length = 0;
		const graxia = createGraxia({ schema, batching: { limit: 3 } });
		await graxia.fetch(post([{ query: '{ me }' }, { query: '{ me }' }]));
		expect(seen).toHaveLength(2);
		expect(seen[0]).not.toBe(seen[1]);
		expect((seen[0] as any).signal).not.toBe((seen[1] as any).signal);
	});

	test('serve() forwards Bun server in the context', async () => {
		let server: unknown;
		const graxia = createGraxia({
			schema,
			context: ({ serverContext }) => {
				server = (serverContext as Record<string, unknown>)['server'];
				return {};
			},
		});
		const bun = graxia.serve({ port: 0 });
		const res = await fetch(`http://localhost:${bun.port}/graphql`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ query: '{ me }' }),
		});
		await res.text();
		expect(server).toBe(bun);
		await graxia.dispose();
	});
});

describe('cancellation', () => {
	test('aborting the request aborts the resolver signal', async () => {
		const controller = new AbortController();
		let started!: () => void;
		const running = new Promise<void>((resolve) => {
			started = resolve;
		});
		let saw = false;
		const onUnexpected = mock();
		const graxia = createGraxia({
			schema,
			onUnexpected,
			context: () => ({ started, sawAbort: () => (saw = true) }),
		});
		const response = graxia.fetch(
			post({ query: '{ wait }' }, controller.signal),
		);
		await running;
		controller.abort();
		const res = await response;
		expect(saw).toBe(true);
		expect(onUnexpected).not.toHaveBeenCalled();
		expect(res.status).toBe(499);
		expect(await res.text()).toContain('OPERATION_ABORTED');
	});
});

describe('getContext', () => {
	test('returns the operation context inside a resolver', async () => {
		const graxia = createGraxia({ schema });
		const res = await graxia.fetch(post({ query: '{ ctx }' }));
		expect(await res.json()).toEqual({ data: { ctx: 'true' } });
	});

	test('throws outside an operation, tryGetContext returns undefined', () => {
		expect(() => getContext()).toThrow(GraxiaConfigError);
		expect(() => getContext()).toThrow('outside a graxia operation');
		expect(tryGetContext()).toBeUndefined();
	});

	test('is visible inside an onExecute hook', async () => {
		let inHook: unknown;
		const graxia = createGraxia({
			schema,
			plugins: [
				definePlugin()({
					name: 'peek',
					onExecute: ({ args }) => {
						inHook = tryGetContext() === args.contextValue;
					},
				}),
			],
		});
		await graxia.fetch(post({ query: '{ me }' }));
		expect(inHook).toBe(true);
	});

	test('asyncContext: false skips the store and names the option', async () => {
		const graxia = createGraxia({ schema, asyncContext: false });
		const res = await graxia.fetch(post({ query: '{ ctx }' }));
		const body = (await res.json()) as { errors: { message: string }[] };
		expect(body.errors[0]?.message).toContain('asyncContext: false');
	});
});
