import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as api from '@opentelemetry/api';
import { trace } from '@opentelemetry/api';
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
	TracerProvider,
} from '@opentelemetry/sdk-trace';
import { jsonResponse } from '../http/respond';
import { definePlugin } from '../plugins/define';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import { settleOutcome } from './operation';
import { type Env, start } from './spans';
import {
	closeAll,
	finished,
	make,
	post,
	reset,
	schema,
} from './telemetry.test-util';

beforeEach(reset);
afterEach(closeAll);

describe('review', () => {
	test('a bad telemetry option throws before any plugin setup runs', () => {
		let setups = 0;
		const plugin = { name: 'p', setup: () => void setups++ };
		expect(() =>
			createGraxia({
				schema,
				plugins: [plugin],
				telemetry: { document: 1 },
			} as any),
		).toThrow('telemetry.document must be a boolean');
		expect(setups).toBe(0);
	});

	test('with a non-recording request span nothing is cloned, parsed or spanned', async () => {
		const clone = spyOn(Response.prototype, 'clone');
		try {
			const graxia = make({ telemetry: { tracer: trace.getTracer('noop') } });
			const refused = await graxia.fetch(
				new Request(
					`http://x/graphql?query=${encodeURIComponent('{ hello }')}`,
				),
			);
			expect(refused.status).toBe(403);
			const ok = await graxia.fetch(post({ query: '{ hello }' }));
			expect(ok.status).toBe(200);
			expect(await ok.json()).toEqual({ data: { hello: 'world' } });
			expect(clone).not.toHaveBeenCalled();
			expect(finished()).toHaveLength(0);
		} finally {
			clone.mockRestore();
		}
	});

	test('two instances over one schema each trace their own operations', async () => {
		const mine = createSchema()({
			typeDefs: 'type Query { a: String }',
			resolvers: { Query: { a: () => 'x' } },
		});
		const make2 = () => {
			const exporter = new InMemorySpanExporter();
			const tracer = new TracerProvider({
				spanProcessors: [new SimpleSpanProcessor({ exporter })],
			}).getTracer('t');
			const graxia = createGraxia({
				schema: mine,
				telemetry: { tracer, resolverSpans: true },
			});
			return { exporter, graxia };
		};
		const first = make2();
		const second = make2();
		const run = (g: { fetch: (r: Request) => Promise<Response> }) =>
			g.fetch(post({ query: '{ a }' }));
		await run(first.graxia);
		const count = (e: InMemorySpanExporter, name: string) =>
			e.getFinishedSpans().filter((s) => s.name === name).length;
		expect(count(first.exporter, 'graphql.resolve a')).toBe(1);
		expect(count(second.exporter, 'graphql.resolve a')).toBe(0);
		await run(second.graxia);
		expect(count(first.exporter, 'graphql.resolve a')).toBe(1);
		expect(count(second.exporter, 'graphql.resolve a')).toBe(1);
		expect(count(second.exporter, 'graphql.request')).toBe(1);
		await first.graxia.dispose();
		await second.graxia.dispose();
	});

	test('a stream whose stop signal is already aborted ends its span at once', () => {
		const exporter = new InMemorySpanExporter();
		const tr = new TracerProvider({
			spanProcessors: [new SimpleSpanProcessor({ exporter })],
		}).getTracer('t');
		const env = { api, tracer: tr, document: false, propagate: false } as Env;
		const live = start(env, 'graphql.operation', 1, api.context.active());
		const op = { live, errors: 0, events: 0, ended: false };
		const stop = new AbortController();
		stop.abort();
		const source = { next: async () => ({ done: true, value: undefined }) };
		settleOutcome(
			env,
			schema,
			op,
			{ kind: 'stream', stop, source, scope: (w: any) => w() } as any,
			(w) => w(),
		);
		expect(op.ended).toBe(true);
		expect(exporter.getFinishedSpans()).toHaveLength(1);
	});
});

describe('refusal code read', () => {
	test('a 4xx JSON stream without content-length is not read', async () => {
		const body = '{"errors":[{"extensions":{"code":"LATE"}}]}';
		const graxia = make({
			plugins: [
				definePlugin({
					name: 'stream-refusal',
					onResponse: ({ setResponse }) =>
						setResponse(
							new Response(
								new ReadableStream({
									start(controller) {
										controller.enqueue(new TextEncoder().encode(body));
										controller.close();
									},
								}),
								{
									status: 400,
									headers: { 'content-type': 'application/json' },
								},
							),
						),
				}),
			],
		});
		const response = await graxia.fetch(post({ query: '{ hello }' }));
		expect(response.status).toBe(400);
		expect(await response.text()).toBe(body);
		const [request] = finished().filter((s) => s.name === 'graphql.request');
		expect(request?.attributes['graxia.refusal.code']).toBeUndefined();
	});

	test('a jsonResponse refusal declares its content-length', () => {
		const response = jsonResponse(
			{ errors: [{ message: 'é' }] },
			400,
			'application/json',
		);
		expect(response.headers.get('content-length')).toBe(
			String(Buffer.byteLength('{"errors":[{"message":"é"}]}')),
		);
	});
});
