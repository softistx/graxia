import { McpServer, type McpServerFactory } from '@modelcontextprotocol/server';
import { mcpAuth } from './auth/principal';
import { canWrite } from './auth/scopes';
import type { ResolvedAuth } from './auth/types';
import type { ContextCarrier } from './context';
import { registerOperationTools } from './operations/register';
import type { OperationTool } from './operations/types';
import type { VisibleTools } from './operations/visible';
import type { McpHost, McpOptions } from './options';
import { registerTools } from './tools';
import type { ExecuteContext } from './tools/execute';
import type { ViewSource } from './view-cache';

/** The per-request pieces a tool call needs, once the request is known. */
export type RequestContext = Pick<
	ExecuteContext,
	| 'graxia'
	| 'view'
	| 'serverContext'
	| 'headers'
	| 'signal'
	| 'writeScope'
	| 'onError'
>;

/** Headers that describe the MCP exchange, not the caller: they are not forwarded to `context`. */
const OWN_HEADERS =
	/^(content-type|content-length|accept|host|origin|connection|transfer-encoding|mcp-.*)$/i;

/** The headers `graxia.execute` sees: the caller's (an `Authorization`, a session cookie), minus the transport's. */
export function forwardedHeaders(request: Request): Headers {
	const headers = new Headers();
	for (const [name, value] of request.headers)
		if (!OWN_HEADERS.test(name)) headers.set(name, value);
	return headers;
}

/** One stateless MCP server for one request. */
export function buildServer(
	options: McpOptions<any>,
	context: RequestContext,
	mutations: boolean,
	typed: readonly OperationTool[] = [],
): McpServer {
	const server = new McpServer(
		{ name: options.name, version: options.version ?? '0.0.0' },
		options.instructions ? { instructions: options.instructions } : undefined,
	);
	registerTools(server, {
		context,
		mutations,
		generic: options.genericTools ?? true,
		typed: typed.map((tool) => tool.name),
	});
	registerOperationTools(server, typed, context);
	return server;
}

/** What {@link serverFactory} builds every request's server from. */
export interface ServerSettings {
	graxia: McpHost<any>;
	options: McpOptions<any>;
	auth: ResolvedAuth | undefined;
	carrier: ContextCarrier;
	views: ViewSource;
	/** The typed tools a view allows; absent without `operations`. */
	visibleTools?: VisibleTools | undefined;
	onError: (error: unknown) => void;
}

/**
 * The SDK's per-request factory: the server of one caller, from the
 * `serverContext` and the principal `fetch` put in their stores.
 * `graphql_mutate` and the typed tools of mutations are registered when
 * `mutations` is on and, with `auth`, the token has the write scope. A typed
 * tool is registered only when the caller's view allows its operation, so
 * with `operations` the view is built for every request (once for all
 * without `can`); a view that fails to build offers no typed tool.
 */
export function serverFactory(settings: ServerSettings): McpServerFactory {
	const { graxia, options, auth, carrier, views, visibleTools, onError } =
		settings;
	return async ({ requestInfo }) => {
		const request = requestInfo as Request;
		const serverContext = carrier.current();
		const principal = mcpAuth();
		const mutations =
			(options.mutations ?? false) &&
			(auth === undefined ||
				(principal !== undefined && canWrite(auth, principal)));
		const view = views(request, serverContext, principal);
		let typed: readonly OperationTool[] = [];
		if (visibleTools)
			try {
				typed = visibleTools(await view()).filter(
					(tool) => mutations || tool.kind === 'query',
				);
			} catch (error) {
				onError(error);
			}
		return buildServer(
			options,
			{
				graxia,
				view,
				serverContext,
				headers: forwardedHeaders(request),
				signal: request.signal,
				writeScope: auth?.write,
				onError,
			},
			mutations,
			typed,
		);
	};
}
