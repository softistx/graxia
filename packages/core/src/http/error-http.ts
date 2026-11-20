import type { ExecutionResult, GraphQLFormattedError } from 'graphql';
import type { MediaType } from './negotiate';

/** What a GraphQL error's `extensions.http` may ask of the plain JSON response. */
export interface ErrorHttp {
	/** An integer from 200 to 599; the highest of the result's errors wins. */
	status?: number;
	/** Merged into the response headers (a later error wins on a clash). */
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
	result: ExecutionResult;
}

const isStatus = (value: unknown): value is number =>
	Number.isInteger(value) &&
	(value as number) >= 200 &&
	(value as number) <= 599;

function validHeaders(value: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (typeof value !== 'object' || value === null) return out;
	for (const [name, v] of Object.entries(value)) {
		if (typeof v !== 'string') continue;
		try {
			new Headers().set(name, v);
		} catch {
			continue;
		}
		out[name] = v;
	}
	return out;
}

/**
 * Reads `extensions.http` of the errors of one (already masked) result, the
 * way graphql-yoga's `getResponseInitByRespectingErrors` does: the highest
 * status wins, headers are merged, and `spec: true` ignores the status under
 * `application/json`. `http` is removed from the serialized extensions.
 */
export function errorHttp(
	result: ExecutionResult,
	media: MediaType,
): ErrorHttpAnswer {
	const errors = result.errors;
	let status: number | undefined;
	let headers: Record<string, string> | undefined;
	let changed = false;
	const cleaned = errors?.map((error) => {
		const extensions = error.extensions as { http?: unknown } | undefined;
		if (!extensions || !('http' in extensions)) return error;
		changed = true;
		const http = extensions.http;
		if (typeof http === 'object' && http !== null) {
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
		const { http: _http, ...rest } = extensions as Record<string, unknown>;
		const { extensions: _kept, ...formatted } =
			error.toJSON() as GraphQLFormattedError;
		return Object.keys(rest).length > 0
			? { ...formatted, extensions: rest }
			: formatted;
	});
	if (!changed || !cleaned) return { status, headers, result };
	return {
		status,
		headers,
		result: { ...result, errors: cleaned } as unknown as ExecutionResult,
	};
}
