import {
	createTelemetry,
	currentSpan,
	memoryExporter,
	type SpanRecord,
} from '@softistx/telemetry';
import { createSchema } from '../schema/create-schema';
import { createGraxia, type Graxia } from '../server/create-graxia';

/** Collects what the spans emit; each spec file has its own copy of this module state. */
export const memory = memoryExporter();
/** The telemetry the specs trace into (`batch: 1`: every span ships at once). */
export const instance = createTelemetry('graxia-test', {
	batch: 1,
	exporters: [memory],
});

/** The spans that ended, oldest first (call `await instance.flush()` after the work). */
export const finished = (): readonly SpanRecord[] => memory.spans;
export const reset = () => memory.clear();
export const named = (name: string) =>
	finished().filter((span) => span.name === name);
export const parentId = (span: SpanRecord): string | undefined => span.parent;
export const idOf = (span: SpanRecord): string => span.context.spanId;
export const traceOf = (span: SpanRecord): string => span.context.traceId;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until(check: () => boolean, ms = 2000) {
	const end = Date.now() + ms;
	while (!check() && Date.now() < end) await sleep(5);
}

export const seen: { span?: unknown; spans: unknown[] } = { spans: [] };

export const schema = createSchema()({
	typeDefs: `
		type Query { hello: String boom: String timeout: String user: User }
		type User { name: String slow: String }
		type Mutation { bump: Int }
		type Subscription { ticks: Int! }
	`,
	resolvers: {
		Query: {
			hello: () => {
				seen.span = currentSpan();
				return 'world';
			},
			boom: () => {
				throw new Error('secret detail');
			},
			timeout: () => {
				throw new DOMException('t', 'TimeoutError');
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
/** A `Graxia` whose `fetch` and `execute` also wait for the spans they made to reach `memory`. */
export function make(options: Record<string, unknown> = {}): Graxia {
	const graxia = createGraxia({
		schema,
		onUnexpected: false,
		telemetry: { instance },
		...options,
	});
	const fetch = graxia.fetch.bind(graxia);
	const execute = graxia.execute.bind(graxia);
	graxia.fetch = async (request) => {
		const response = await fetch(request);
		await instance.flush();
		return response;
	};
	graxia.execute = (async (...args: Parameters<typeof execute>) => {
		const result = await execute(...args);
		await instance.flush();
		return result;
	}) as typeof execute;
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
