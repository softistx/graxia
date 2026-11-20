import type { ExecutionResult, FormattedExecutionResult } from 'graphql';
import type { MediaType } from './negotiate';

const asked = new WeakMap<Response, Record<string, string>>();

/** @internal Binds the headers the errors ask for to the exact Response they belong to. */
export function bindErrorHeaders(
	response: Response,
	headers: Record<string, string>,
): Response {
	asked.set(response, headers);
	return response;
}

/** @internal The headers bound to this Response object, if any (a replaced or rebuilt one has none). */
export function errorHeadersOf(
	response: Response,
): Record<string, string> | undefined {
	return asked.get(response);
}

/** What a GraphQL error's `extensions.http` may ask of the plain JSON response. */
export interface ErrorHttp {
	/** An integer from 200 to 599; the highest of the result's errors wins. */
	status?: number;
	/** Added to the response headers when the plugins and the response do not set them; a later error wins on a clash. */
	headers?: Record<string, string>;
	/**
	 * Under `application/json`, the error's status is ignored (headers still
	 * apply): the legacy media type answers 200 for a spec-shaped error.
	 */
	spec?: boolean;
}

/** The status and headers the errors of a result ask for, and the result without their `http`. */
export interface ErrorHttpAnswer {
	status: number | undefined;
	headers: Record<string, string> | undefined;
	/** The result with `http` removed from each error's `extensions`; the same object when no error carried one. */
	result: ExecutionResult | FormattedExecutionResult;
}

type Result = ExecutionResult | FormattedExecutionResult;
type Anyone = { extensions?: Record<string, unknown> | undefined };

/** Framing and hop-by-hop headers an error may never set. */
const FORBIDDEN = new Set([
	'content-length',
	'content-encoding',
	'transfer-encoding',
	'connection',
	'content-type',
	'keep-alive',
	'upgrade',
	'te',
	'trailer',
]);

const isStatus = (value: unknown): value is number =>
	Number.isInteger(value) &&
	(value as number) >= 200 &&
	(value as number) <= 599;

function validHeaders(value: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (typeof value !== 'object' || value === null) return out;
	for (const [name, v] of Object.entries(value)) {
		if (typeof v !== 'string' || FORBIDDEN.has(name.toLowerCase())) continue;
		try {
			new Headers().set(name, v);
		} catch {
			continue;
		}
		out[name] = v;
	}
	return out;
}

const hasHttp = (error: unknown): boolean => {
	if (typeof error !== 'object' || error === null) return false;
	const ext = (error as Anyone).extensions;
	return typeof ext === 'object' && ext !== null && 'http' in ext;
};

/** An error as a plain formatted object, without `extensions.http`. */
function withoutHttp(error: unknown): unknown {
	const source = error as { toJSON?: () => unknown };
	const formatted = (
		typeof source.toJSON === 'function'
			? source.toJSON()
			: { ...(error as object) }
	) as { extensions?: Record<string, unknown> };
	const { extensions, ...rest } = formatted;
	const { http: _http, ...kept } = extensions ?? {};
	return Object.keys(kept).length > 0 ? { ...rest, extensions: kept } : rest;
}

/** The result with `http` removed from every error's extensions (the same object when none has it). */
export function stripErrorHttp<T extends object>(result: T): T {
	const errors = (result as { errors?: unknown }).errors;
	if (!Array.isArray(errors) || !errors.some(hasHttp)) return result;
	return {
		...result,
		errors: errors.map((error) =>
			hasHttp(error) ? withoutHttp(error) : error,
		),
	};
}

/**
 * Like {@link stripErrorHttp}, for one stream payload: also the `errors` of
 * its `incremental` and `completed` entries.
 */
export function stripPayloadHttp<T extends object>(payload: T): T {
	let out: Record<string, unknown> = stripErrorHttp(payload) as Record<
		string,
		unknown
	>;
	for (const key of ['incremental', 'completed']) {
		const entries = out[key];
		if (!Array.isArray(entries)) continue;
		const carries = (entry: unknown) =>
			typeof entry === 'object' &&
			entry !== null &&
			(entry as { errors?: unknown[] }).errors?.some(hasHttp) === true;
		if (!entries.some(carries)) continue;
		out = {
			...out,
			[key]: entries.map((entry) =>
				carries(entry) ? stripErrorHttp(entry) : entry,
			),
		};
	}
	return out as T;
}

/**
 * Reads `extensions.http` of the errors of one (already masked) result, the
 * way graphql-yoga's `getResponseInitByRespectingErrors` does: the highest
 * status wins, headers are merged, and `spec: true` ignores the status under
 * `application/json`. `http` is removed from the serialized extensions.
 */
export function readErrorHttp(
	result: Result,
	media: MediaType,
): ErrorHttpAnswer {
	const errors = result.errors as readonly unknown[] | undefined;
	if (!errors?.some(hasHttp))
		return { status: undefined, headers: undefined, result };
	let status: number | undefined;
	let headers: Record<string, string> | undefined;
	for (const error of errors) {
		if (!hasHttp(error)) continue;
		const http = (error as { extensions: { http: unknown } }).extensions.http;
		if (typeof http !== 'object' || http === null) continue;
		const { status: asked, headers: sent, spec } = http as ErrorHttp;
		const merged = validHeaders(sent);
		if (Object.keys(merged).length > 0) headers = { ...headers, ...merged };
		if (
			isStatus(asked) &&
			!(media === 'application/json' && spec) &&
			(status === undefined || asked > status)
		)
			status = asked;
	}
	return { status, headers, result: stripErrorHttp(result) };
}
