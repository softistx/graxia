import type { GraphQLFormattedError } from 'graphql';
import type { DocumentInput } from '../document/typed';

/** The default `Accept` of the client: both GraphQL over HTTP media types. */
export const DEFAULT_ACCEPT =
	'application/graphql-response+json, application/json';

/** Options of one `query`, `mutate` or batch entry. */
export interface TestOperationOptions<Variables> {
	/** The operation's variables. */
	variables?: Variables;
	/** Which operation to run when the document has several. */
	operationName?: string;
	/** Extra headers for this request, over the client's. */
	headers?: HeadersInit;
	/**
	 * `true` sends the persisted-query form: `extensions.persistedQuery`
	 * `{ version: 1, sha256Hash }` with the hash computed from the document and
	 * the query alongside. `{ sha256Hash }` sends that hash; pass `null` as the
	 * document to omit the query text.
	 */
	persisted?: boolean | { sha256Hash: string };
}

/** Options of `client.query`. */
export interface TestQueryOptions<Variables>
	extends TestOperationOptions<Variables> {
	/** `POST` by default; `GET` encodes the query string. */
	method?: 'POST' | 'GET';
	/** The `Accept` header; both GraphQL over HTTP media types by default. */
	accept?: string;
}

/** Options of `client.mutate` (always `POST`). */
export interface TestMutateOptions<Variables>
	extends TestOperationOptions<Variables> {
	/** The `Accept` header; both GraphQL over HTTP media types by default. */
	accept?: string;
}

/** One batch entry: a document and its options. */
export interface TestBatchEntry<
	Result = Record<string, any>,
	Variables = Record<string, any>,
> extends TestOperationOptions<Variables> {
	/** The document, or `null` with `persisted: { sha256Hash }`. */
	document: DocumentInput<Result, Variables> | null;
}

/** What the client returns for one operation. */
export interface TestResult<Result> {
	/** The HTTP status. */
	status: number;
	/** The response headers. */
	headers: Headers;
	/** The parsed JSON body, or the text when it is not JSON. */
	body: unknown;
	/** `body.data`: the result, `null` when execution failed, `undefined` when absent. */
	data: Result | null | undefined;
	/** `body.errors`, when present. */
	errors: readonly GraphQLFormattedError[] | undefined;
	/** `body.extensions`, when present. */
	extensions: Record<string, unknown> | undefined;
	/** The raw response (its body is already read). */
	response: Response;
}

/** What `client.batch` returns: the HTTP answer and one entry per operation. */
export interface TestBatchResult {
	status: number;
	headers: Headers;
	body: unknown;
	/** One `{ data, errors, extensions }` per entry; empty when the body is not an array. */
	results: Pick<TestResult<any>, 'data' | 'errors' | 'extensions'>[];
	response: Response;
}
