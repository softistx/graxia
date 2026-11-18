import type { DocumentNode, TypedQueryDocumentNode } from 'graphql';

/**
 * A document that carries its result and variables types, structurally
 * compatible with `TypedDocumentNode` of `@graphql-typed-document-node/core`
 * (what codegen's default `documentMode` emits).
 */
export type TypedDocument<Result, Variables> = DocumentNode & {
	__apiType?: (variables: Variables) => Result;
};

/**
 * A document string that carries its result and variables types, as codegen's
 * `string` `documentMode` emits.
 */
export type TypedString<Result, Variables> = string & {
	__apiType?: (variables: Variables) => Result;
};

/** Every document form `execute` and the test client accept, typed or not. */
export type DocumentInput<Result, Variables> =
	| TypedDocument<Result, Variables>
	| TypedQueryDocumentNode<Result, Variables>
	| TypedString<Result, Variables>
	| DocumentNode
	| string;
