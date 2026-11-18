import type { DocumentInput } from '../document/typed';
import { isRecord } from '../http/record';
import { DEFAULT_CSRF_HEADERS } from '../security/options';
import type { Graxia } from '../server/create-graxia';
import type { OptionsArg, WithServerContext } from '../server/host-context';
import { getUrl, type WireParams, wireParams } from './request';
import {
	DEFAULT_ACCEPT,
	type TestBatchEntry,
	type TestBatchResult,
	type TestMutateOptions,
	type TestQueryOptions,
	type TestResult,
} from './types';

/** Options of {@link createTestClient}: `serverContext` is required when `HostCtx` has required keys. */
export type TestClientOptions<HostCtx extends object> = TestClientBase &
	WithServerContext<HostCtx>;

/** The options of {@link createTestClient} that do not depend on the host context. */
export interface TestClientBase {
	/** The path requests go to; `/graphql` by default. */
	path?: string;
	/** Headers sent with every request; a request's own headers win. */
	headers?: HeadersInit;
}

/** A client that talks to a graxia instance through `graxia.fetch`, in process. */
export interface TestClient {
	/** Runs a query (POST by default, or GET). */
	query<Result = Record<string, any>, Variables = Record<string, any>>(
		document: DocumentInput<Result, Variables> | null,
		options?: TestQueryOptions<Variables>,
	): Promise<TestResult<Result>>;
	/** Runs a mutation (always POST). */
	mutate<Result = Record<string, any>, Variables = Record<string, any>>(
		document: DocumentInput<Result, Variables> | null,
		options?: TestMutateOptions<Variables>,
	): Promise<TestResult<Result>>;
	/** Sends a JSON array of operations; needs the `batching` option. */
	batch(
		entries: readonly TestBatchEntry[],
		options?: { headers?: HeadersInit; accept?: string },
	): Promise<TestBatchResult>;
}

async function readBody(response: Response): Promise<unknown> {
	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function picks(body: unknown) {
	const record = isRecord(body) ? body : {};
	return {
		data: record['data'],
		errors: record['errors'],
		extensions: record['extensions'],
	};
}

/**
 * Creates a test client over `graxia.fetch`: real HTTP semantics (status,
 * headers, negotiation, GET encoding, batching) without a socket.
 *
 * @example
 * const client = createTestClient(graxia);
 * const { data, status } = await client.query<{ hello: string }>('{ hello }');
 */
export function createTestClient<HostCtx extends object>(
	graxia: Pick<Graxia<HostCtx>, 'fetch'>,
	...[clientOptions]: OptionsArg<HostCtx, TestClientBase>
): TestClient {
	const options: TestClientBase & { serverContext?: HostCtx } =
		clientOptions ?? {};
	const base = `http://graxia.local${options.path ?? '/graphql'}`;
	const send = async (
		method: 'GET' | 'POST',
		payload: WireParams | WireParams[],
		accept: string | undefined,
		headers: HeadersInit | undefined,
	): Promise<{ response: Response; body: unknown }> => {
		const merged = new Headers(options.headers);
		for (const [name, value] of new Headers(headers)) merged.set(name, value);
		// A browserless client sends a CSRF header on a GET (the server's default asks for one).
		if (method === 'GET' && !DEFAULT_CSRF_HEADERS.some((n) => merged.has(n)))
			merged.set('x-graphql-csrf', '1');
		if (!merged.has('accept')) merged.set('accept', accept ?? DEFAULT_ACCEPT);
		else if (accept !== undefined) merged.set('accept', accept);
		const request =
			method === 'GET'
				? new Request(getUrl(base, payload as WireParams), {
						method,
						headers: merged,
					})
				: new Request(base, {
						method,
						headers: new Headers([
							['content-type', 'application/json'],
							...merged,
						]),
						body: JSON.stringify(payload),
					});
		const response = await (
			graxia.fetch as (r: Request, c?: object) => Promise<Response>
		)(request, options.serverContext);
		return { response, body: await readBody(response) };
	};
	const one = async (
		method: 'GET' | 'POST',
		document: DocumentInput<any, any> | null,
		opts: TestQueryOptions<any>,
	): Promise<TestResult<any>> => {
		const { response, body } = await send(
			method,
			wireParams(document, opts),
			opts.accept,
			opts.headers,
		);
		return {
			status: response.status,
			headers: response.headers,
			body,
			response,
			...picks(body),
		};
	};
	return {
		query: (document, opts = {}) => one(opts.method ?? 'POST', document, opts),
		mutate: (document, opts = {}) => one('POST', document, opts),
		async batch(entries, opts = {}) {
			const { response, body } = await send(
				'POST',
				entries.map((entry) => wireParams(entry.document, entry)),
				opts.accept,
				opts.headers,
			);
			return {
				status: response.status,
				headers: response.headers,
				body,
				response,
				results: Array.isArray(body) ? body.map(picks) : [],
			};
		},
	};
}
