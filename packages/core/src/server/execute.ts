import { type DocumentNode, type ExecutionResult, print } from 'graphql';
import type { DocumentInput } from '../document/typed';
import { GraxiaExecuteError } from '../errors/execute-error';
import { RequestState } from '../plugins/state';
import { presetDocumentKey, resultKey } from './execute-state';
import type { Lifecycle } from './lifecycle';

/** Arguments of {@link Graxia.execute}. */
export interface ExecuteArgs<Result, Variables, HostCtx> {
	/** A typed document, a `DocumentNode` (parse is skipped) or a string (parsed through the cache). */
	document: DocumentInput<Result, Variables>;
	/** The operation's variables. */
	variables?: Variables;
	/** Which operation to run when the document has several. */
	operationName?: string;
	/** Headers of the synthetic request (what `onRequest` and `context` see). */
	headers?: HeadersInit;
	/** Merged into the operation's context, as `fetch(request, serverContext)`. */
	serverContext?: HostCtx;
	/** Aborts the operation, like a client leaving. */
	signal?: AbortSignal;
}

/** @internal What `createExecute` needs from the instance. */
export interface ExecuteParts {
	/** The shared request pipeline (what `fetch` runs). */
	run(
		request: Request,
		serverContext: Record<string, unknown>,
		state: RequestState,
	): Promise<Response>;
	lifecycle: Lifecycle;
	/** The served path; any path when the instance serves `false`. */
	path: string | false;
	/** The status and body of the refusal sent after `dispose()`. */
	closed(): Response;
}

/**
 * @internal Builds `execute`: a synthetic `POST` request goes through the same
 * pipeline as HTTP, and the masked result is read back from the request
 * state instead of being encoded.
 */
export function createExecute<HostCtx extends object>(parts: ExecuteParts) {
	return async function execute<Result, Variables>(
		args: ExecuteArgs<Result, Variables, HostCtx>,
	): Promise<ExecutionResult<Result>> {
		if (parts.lifecycle.closing)
			throw new GraxiaExecuteError('Server is shutting down.', parts.closed());
		const state = new RequestState();
		const document =
			typeof args.document === 'string'
				? undefined
				: (args.document as DocumentNode);
		if (document) state.set(presetDocumentKey, document);
		const query =
			typeof args.document === 'string'
				? (args.document as string)
				: print(document as DocumentNode);
		const headers = new Headers({
			'content-type': 'application/json',
			accept: 'application/graphql-response+json, application/json',
		});
		for (const [name, value] of new Headers(args.headers))
			headers.set(name, value);
		const request = new Request(
			`http://graxia.local${parts.path === false ? '/' : parts.path}`,
			{
				method: 'POST',
				headers,
				body: JSON.stringify({
					query,
					...(args.variables !== undefined
						? { variables: args.variables }
						: {}),
					...(args.operationName !== undefined
						? { operationName: args.operationName }
						: {}),
				}),
				...(args.signal ? { signal: args.signal } : {}),
			},
		);
		const response = await parts.run(request, { ...args.serverContext }, state);
		const result = state.get(resultKey);
		if (result === undefined)
			throw new GraxiaExecuteError(
				`graxia.execute: the request ended with an HTTP ${response.status} response instead of a result; see error.response.`,
				response,
			);
		return result as ExecutionResult<Result>;
	};
}
