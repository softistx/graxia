import { McpServer } from '@modelcontextprotocol/server';
import type { McpOptions } from './options';
import { registerTools } from './tools';
import type { ExecuteContext } from './tools/execute';

/** The per-request pieces a tool call needs, once the request is known. */
export type RequestContext = Pick<
	ExecuteContext,
	'graxia' | 'view' | 'serverContext' | 'headers' | 'signal' | 'onError'
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
): McpServer {
	const server = new McpServer(
		{ name: options.name, version: options.version ?? '0.0.0' },
		options.instructions ? { instructions: options.instructions } : undefined,
	);
	registerTools(server, { context, mutations: options.mutations ?? false });
	return server;
}
