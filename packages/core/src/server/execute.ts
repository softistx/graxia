import { type DocumentNode, type ExecutionResult, print } from 'graphql';
import type { DocumentInput } from '../document/typed';
import { GraxiaExecuteError } from '../errors/execute-error';
import { StateBag } from '../plugins/state';
import {
	inProcessKey,
	presetDocumentKey,
	resultKey,
	unexpectedErrorKey,
} from './execute-state';
import type { WithServerContext } from './host-context';
import type { Lifecycle } from './lifecycle';

/** Arguments of {@link Graxia.execute}: `serverContext` is required when `HostCtx` has required keys. */
export type ExecuteArgs<
	Result,
	Variables,
	HostCtx extends object,
> = ExecuteBase<Result, Variables> & WithServerContext<HostCtx>;

/** The arguments of {@link Graxia.execute} that do not depend on the host context. */
export interface ExecuteBase<Result, Variables> {
	/**
	 * A typed document, a `DocumentNode` or a string. A string is parsed under
	 * the parse limits and goes through both caches; a `DocumentNode` skips the
	 * parse limits and both caches (it is already parsed). `onParse` runs for both.
	 */
	document: DocumentInput<Result, Variables>;
	/** The operation's variables; they travel as JSON, so they must be JSON-serializable. */
	variables?: Variables;
	/** Which operation to run when the document has several. */
	operationName?: string;
	/** Headers of the synthetic request (what `onRequest` and `context` see). */
	headers?: HeadersInit;
	/** Aborts the operation, like a client leaving. */
	signal?: AbortSignal;
}

/** @internal What `createExecute` needs from the instance. */
export interface ExecuteParts {
	/** The shared request pipeline (what `fetch` runs). */
	run(
		request: Request,
		serverContext: Record<string, unknown>,
		state: StateBag,
	): Promise<Response>;
	lifecycle: Lifecycle;
	/** The served path; any path when the instance serves `false`. */
	path: string | false;
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
		const state = new StateBag();
		state.set(inProcessKey, true);
		const document =
			typeof args.document === 'string'
				? undefined
				: (args.document as DocumentNode);
		const query =
			typeof args.document === 'string'
				? (args.document as string)
				: print(document as DocumentNode);
		if (document) state.set(presetDocumentKey, { node: document, text: query });
		const headers = new Headers({
			'content-type': 'application/json',
			accept: 'application/graphql-response+json, application/json',
		});
		for (const [name, value] of new Headers(args.headers))
			headers.set(name, value);
		let body: string;
		try {
			body = JSON.stringify({
				query,
				...(args.variables !== undefined ? { variables: args.variables } : {}),
				...(args.operationName !== undefined
					? { operationName: args.operationName }
					: {}),
			});
		} catch (error) {
			throw new TypeError(
				'graxia.execute: variables must be JSON-serializable (no BigInt, no cycles)',
				{ cause: error },
			);
		}
		const request = new Request(
			`http://graxia.local${parts.path === false ? '/' : parts.path}`,
			{
				method: 'POST',
				headers,
				body,
				...(args.signal ? { signal: args.signal } : {}),
			},
		);
		const response = await parts.run(request, { ...args.serverContext }, state);
		const result = state.get(resultKey);
		if (result === undefined) {
			const cause = state.get(unexpectedErrorKey);
			throw new GraxiaExecuteError(
				response.status === 503 && parts.lifecycle.closing
					? 'Server is shutting down.'
					: `graxia.execute: the request ended with an HTTP ${response.status} response instead of a result; see error.response.`,
				response,
				cause ? { cause: cause.error } : undefined,
			);
		}
		return result as ExecutionResult<Result>;
	};
}
