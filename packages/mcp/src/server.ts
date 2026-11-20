import { McpServer, type McpServerFactory } from '@modelcontextprotocol/server';
import { mcpAuth } from './auth/principal';
import { canWrite } from './auth/scopes';
import type { ResolvedAuth } from './auth/types';
import type { ContextCarrier, RequestState } from './context';
import {
	registerFailedTools,
	registerOperationTools,
} from './operations/register';
import type { OperationTool } from './operations/types';
import type { McpHost, McpOptions } from './options';
import { registerTools } from './tools';
import type { ExecuteContext } from './tools/execute';
import type { Toolset } from './toolset';

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

/** What {@link serverFactory} builds every request's server from. */
export interface ServerSettings {
	graxia: McpHost<any>;
	options: McpOptions<any>;
	auth: ResolvedAuth | undefined;
	carrier: ContextCarrier;
	toolset: Toolset;
	onError: (error: unknown) => void;
}

/** The typed tools of one caller: `offered`, or `failed` when the view did not build. */
interface Typed {
	offered: readonly OperationTool[];
	failed: readonly OperationTool[];
}

/**
 * The typed tools the caller's view allows. The view is built (and `can`
 * run) only for a request that lists or calls tools: `initialize`, `ping`
 * and notifications never pay for it. When it fails to build, nothing is
 * offered; a request that only calls gets the known names as failing tools.
 */
async function typedFor(
	settings: ServerSettings,
	state: RequestState,
	mutations: boolean,
): Promise<Typed> {
	const { toolset, onError } = settings;
	const { list, called } = state.calls;
	if (toolset.typed.length === 0 || !(list || called.length > 0))
		return { offered: [], failed: [] };
	const mine = (tool: OperationTool) => mutations || tool.kind === 'query';
	try {
		const visible = toolset.visible(await state.view());
		return { offered: visible.filter(mine), failed: [] };
	} catch (error) {
		onError(error);
		return { offered: [], failed: list ? [] : toolset.typed.filter(mine) };
	}
}

/**
 * The SDK's per-request factory: the stateless server of one caller, from
 * the state and the principal `fetch` put in their stores. `graphql_mutate`
 * and the typed tools of mutations are registered when `mutations` is on
 * and, with `auth`, the token has the write scope. A typed tool is
 * registered only when the caller's view allows its operation.
 */
export function serverFactory(settings: ServerSettings): McpServerFactory {
	const { graxia, options, auth, carrier, toolset, onError } = settings;
	return async ({ requestInfo }) => {
		const request = requestInfo as Request;
		const state = carrier.current();
		const principal = mcpAuth();
		const mutations =
			(options.mutations ?? false) &&
			(auth === undefined ||
				(principal !== undefined && canWrite(auth, principal)));
		const typed = await typedFor(settings, state, mutations);
		const context: RequestContext = {
			graxia,
			view: state.view,
			serverContext: state.serverContext,
			headers: forwardedHeaders(request),
			signal: request.signal,
			writeScope: auth?.write,
			onError,
		};
		const server = new McpServer(
			{ name: options.name, version: options.version ?? '0.0.0' },
			options.instructions ? { instructions: options.instructions } : undefined,
		);
		registerTools(server, {
			context,
			mutations,
			generic: toolset.generic,
			listing: state.calls.list,
			typed: typed.offered.map((tool) => tool.name),
		});
		registerOperationTools(server, typed.offered, context);
		registerFailedTools(server, typed.failed);
		return server;
	};
}
