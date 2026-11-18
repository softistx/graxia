import type { DocumentInput } from '../document/typed';
import { documentText, sha256Hex } from './document';
import type { TestOperationOptions } from './types';

/** The GraphQL parameters of one operation, as they travel in a body or a query string. */
export interface WireParams {
	query?: string;
	documentId?: string;
	variables?: unknown;
	operationName?: string;
	extensions?: { persistedQuery: { version: 1; sha256Hash: string } };
}

/** Builds the wire parameters of one operation, with the APQ extension when asked. */
export function wireParams(
	document: DocumentInput<any, any> | null,
	options: TestOperationOptions<unknown>,
): WireParams {
	const text = document === null ? undefined : documentText(document);
	const { persisted } = options;
	let hash: string | undefined;
	if (typeof persisted === 'object') hash = persisted.sha256Hash;
	else if (persisted === true) {
		if (text === undefined)
			throw new TypeError(
				'persisted: true needs a document; pass { sha256Hash } to send a hash alone',
			);
		hash = sha256Hex(text);
	}
	if (text === undefined && hash === undefined && !options.documentId)
		throw new TypeError(
			'A null document needs persisted: { sha256Hash } or documentId',
		);
	return {
		...(options.documentId !== undefined
			? { documentId: options.documentId }
			: {}),
		...(text !== undefined ? { query: text } : {}),
		...(options.variables !== undefined
			? { variables: options.variables }
			: {}),
		...(options.operationName !== undefined
			? { operationName: options.operationName }
			: {}),
		...(hash !== undefined
			? { extensions: { persistedQuery: { version: 1, sha256Hash: hash } } }
			: {}),
	};
}

/** The URL of a GET: parameters in the query string, objects as JSON. */
export function getUrl(base: string, params: WireParams): string {
	const url = new URL(base);
	if (params.query !== undefined) url.searchParams.set('query', params.query);
	if (params.documentId !== undefined)
		url.searchParams.set('documentId', params.documentId);
	if (params.operationName !== undefined)
		url.searchParams.set('operationName', params.operationName);
	if (params.variables !== undefined)
		url.searchParams.set('variables', JSON.stringify(params.variables));
	if (params.extensions !== undefined)
		url.searchParams.set('extensions', JSON.stringify(params.extensions));
	return url.toString();
}
