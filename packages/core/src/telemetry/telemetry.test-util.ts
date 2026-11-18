import { AsyncLocalStorage } from 'node:async_hooks';
import {
	type Context,
	type ContextManager,
	context,
	propagation,
	ROOT_CONTEXT,
	type TextMapPropagator,
	trace,
} from '@opentelemetry/api';
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	type ReadableSpan,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { createSchema } from '../schema/create-schema';
import { createGraxia, type Graxia } from '../server/create-graxia';

class AlsContextManager implements ContextManager {
	readonly #store = new AsyncLocalStorage<Context>();
	active = () => this.#store.getStore() ?? ROOT_CONTEXT;
	with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
		ctx: Context,
		fn: F,
		thisArg?: ThisParameterType<F>,
		...args: A
	): ReturnType<F> {
		return this.#store.run(ctx, () => fn.call(thisArg, ...args));
	}
	bind<T>(_ctx: Context, target: T): T {
		return target;
	}
	enable = () => this;
	disable = () => this;
}

const traceparent: TextMapPropagator = {
	inject: () => {},
	fields: () => ['traceparent'],
	extract(ctx, carrier, getter) {
		const value = getter.get(carrier, 'traceparent');
		const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(
			String(value),
		);
		return match
			? trace.setSpanContext(ctx, {
					traceId: match[1] as string,
					spanId: match[2] as string,
					traceFlags: Number.parseInt(match[3] as string, 16),
					isRemote: true,
				})
			: ctx;
	},
};

context.setGlobalContextManager(new AlsContextManager());
propagation.setGlobalPropagator(traceparent);

const exporter = new InMemorySpanExporter();
export const tracer = new BasicTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(exporter)],
}).getTracer('graxia-test');

/** The spans that ended, oldest first. */
export const finished = (): ReadableSpan[] => exporter.getFinishedSpans();
export const reset = () => exporter.reset();
export const named = (name: string) =>
	finished().filter((span) => span.name === name);
export const parentId = (span: ReadableSpan) => span.parentSpanContext?.spanId;
export const idOf = (span: ReadableSpan) => span.spanContext().spanId;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until(check: () => boolean, ms = 2000) {
	const end = Date.now() + ms;
	while (!check() && Date.now() < end) await sleep(5);
}

export const seen: { span?: unknown; spans: unknown[] } = { spans: [] };

export const schema = createSchema()({
	typeDefs: `
		type Query { hello: String boom: String user: User }
		type User { name: String slow: String }
		type Mutation { bump: Int }
		type Subscription { ticks: Int! }
	`,
	resolvers: {
		Query: {
			hello: () => {
				seen.span = trace.getActiveSpan();
				return 'world';
			},
			boom: () => {
				throw new Error('secret detail');
			},
			user: () => ({ name: 'Ada' }),
		},
		User: {
			slow: async () => {
				await sleep(5);
				return 'late';
			},
		},
		Mutation: { bump: () => 1 },
		Subscription: {
			ticks: {
				subscribe: async function* () {
					yield 1;
					yield 2;
				},
				resolve: (n: number) => n,
			},
		},
	},
});

const open: Graxia<any>[] = [];
export const closeAll = () =>
	Promise.all(open.splice(0).map((g) => g.dispose({ timeout: 200 })));
export function make(options: Record<string, unknown> = {}): Graxia {
	const graxia = createGraxia({
		schema,
		onUnexpected: false,
		telemetry: { tracer },
		...options,
	});
	open.push(graxia);
	return graxia;
}

export const post = (
	body: unknown,
	headers: HeadersInit = {},
	url = 'http://x/graphql',
) =>
	new Request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});
