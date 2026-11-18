import { type DocumentNode, print } from 'graphql';
import type { DocumentInput } from '../document/typed';

/** The query text of a document in any accepted form. */
export function documentText(document: DocumentInput<any, any>): string {
	return typeof document === 'string'
		? document
		: print(document as DocumentNode);
}

/** The lowercase hex SHA-256 of `text`, as the APQ `sha256Hash`. */
export function sha256Hex(text: string): string {
	return new Bun.CryptoHasher('sha256').update(text).digest('hex');
}
