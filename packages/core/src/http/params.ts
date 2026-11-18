import type { GraphQLParams } from '../plugins/types';
import { isRecord } from './record';

/** A parsed set of parameters, or the reason the request is malformed (a 400). */
export type ParamsResult =
	| { ok: true; params: GraphQLParams }
	| { ok: false; message: string };

const fail = (message: string): ParamsResult => ({ ok: false, message });

/**
 * Validates one decoded JSON entry (a POST body, or one entry of a batch)
 * into {@link GraphQLParams}. `null` is accepted for `variables`,
 * `operationName` and `extensions` and means absent.
 */
export function paramsFromJson(value: unknown): ParamsResult {
	if (!isRecord(value)) return fail('The request body must be a JSON object.');
	const { query, operationName, variables, extensions } = value;
	if (query !== undefined && query !== null && typeof query !== 'string')
		return fail('The "query" parameter must be a string.');
	if (
		operationName !== undefined &&
		operationName !== null &&
		typeof operationName !== 'string'
	)
		return fail('The "operationName" parameter must be a string.');
	if (variables != null && !isRecord(variables))
		return fail('The "variables" parameter must be an object.');
	if (extensions != null && !isRecord(extensions))
		return fail('The "extensions" parameter must be an object.');
	return {
		ok: true,
		params: {
			...(typeof query === 'string' ? { query } : {}),
			...(typeof operationName === 'string' ? { operationName } : {}),
			...(variables != null ? { variables } : {}),
			...(extensions != null ? { extensions } : {}),
		},
	};
}

type Decoded = { value: unknown } | { message: string };

function jsonParam(url: URL, name: string): Decoded {
	const raw = url.searchParams.get(name);
	if (raw === null || raw === '') return { value: undefined };
	try {
		return { value: JSON.parse(raw) };
	} catch {
		return { message: `The "${name}" parameter must be valid JSON.` };
	}
}

/**
 * Reads the parameters of a GET request from its URL: `query`,
 * `operationName`, and `variables` / `extensions` as JSON.
 */
export function paramsFromUrl(url: URL): ParamsResult {
	const variables = jsonParam(url, 'variables');
	if ('message' in variables) return fail(variables.message);
	const extensions = jsonParam(url, 'extensions');
	if ('message' in extensions) return fail(extensions.message);
	return paramsFromJson({
		query: url.searchParams.get('query') ?? undefined,
		operationName: url.searchParams.get('operationName') ?? undefined,
		variables: variables.value,
		extensions: extensions.value,
	});
}
