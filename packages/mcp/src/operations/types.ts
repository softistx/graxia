import type { TrustedManifest } from '@softistx/graxia';
import type { DocumentNode } from 'graphql';

/** A JSON Schema (2020-12) node, as plain JSON. */
export type JsonSchema = Record<string, unknown>;

/** One persisted operation, as `include` sees it. */
export interface McpOperationInfo {
	/** The operation name (`BookById`). */
	name: string;
	kind: 'query' | 'mutation';
	/** The id of its document in the manifest. */
	id: string;
}

/** The `operations` option of `createMcp`: the persisted operations to expose as typed tools. */
export interface McpOperationsOptions {
	/**
	 * The persisted documents, in any format `trustedDocuments.manifest` takes:
	 * `{ [id]: source }` (graphql-codegen `persisted-documents.json`, Relay
	 * `persisted-queries.json`), an Apollo persisted query manifest, or a `Map`.
	 * Every named query becomes a tool (`BookById` is `book_by_id`); mutations
	 * too with `mutations: true`; subscriptions are skipped.
	 */
	documents: TrustedManifest;
	/** Keeps an operation as a tool when it returns `true`. Absent: every operation. */
	include?: (operation: McpOperationInfo) => boolean;
	/**
	 * Tool descriptions by operation name. One wins over the description
	 * written on the operation itself (`"""…""" query BookById`); an operation
	 * with neither is a boot error.
	 */
	descriptions?: Readonly<Record<string, string>>;
}

/** A typed tool, built once at `createMcp`. */
export interface OperationTool {
	/** The tool name: the operation name in snake_case. */
	name: string;
	/** The operation name. */
	title: string;
	description: string;
	kind: 'query' | 'mutation';
	/** The manifest id of the document. */
	id: string;
	/** The document source, as the manifest holds it. */
	source: string;
	/** The parsed document, to check against a caller's view. */
	document: DocumentNode;
	inputSchema: JsonSchema;
	outputSchema: JsonSchema;
}
