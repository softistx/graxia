import { type DocumentNode, print } from 'graphql';
import type { DocumentInput } from '../document/typed';

/** The query text of a document in any accepted form. */
export function documentText(document: DocumentInput<any, any>): string {
	return typeof document === 'string'
		? document
		: print(document as DocumentNode);
}

export { sha256Hex } from '../trusted/apq';
