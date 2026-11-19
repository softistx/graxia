import type { Graxia, ServerContextArg } from '@graxia/core';
import type { McpAuthInfo, McpAuthOptions } from './auth/types';

/** Whether the caller holds a permission named by `@needs` (what `printSchemaFor`'s `can` takes). */
export type Can = (permission: string) => boolean;

/** Options of {@link createMcp}. */
export interface McpOptions<HostCtx extends object = Record<never, never>> {
	/** The MCP server name, sent to clients as `serverInfo.name`. */
	name: string;
	/** The MCP server version, sent as `serverInfo.version`. Default `'0.0.0'`. */
	version?: string;
	/** Server instructions the client shows to the model: what this API is for. */
	instructions?: string;
	/**
	 * The permissions of the caller, from the request (a token, a session) and
	 * the `serverContext` you passed to `fetch`, and the verified token when
	 * `auth` is set (`auth` is undefined otherwise). It may be async. Absent:
	 * every field is visible.
	 */
	can?: (
		request: Request,
		serverContext: HostCtx,
		auth?: McpAuthInfo,
	) => Can | Promise<Can>;
	/**
	 * Turn the endpoint into an OAuth 2.1 resource server: every request needs
	 * a bearer token your `verifyToken` accepts, with the read scope
	 * (`mcp:read`); `graphql_mutate` also needs the write scope (`mcp:write`).
	 * Serve `mcp.metadata` at `mcp.metadataPath`. Absent: no authentication
	 * here, put the endpoint behind your own.
	 */
	auth?: McpAuthOptions;
	/**
	 * List `graphql_mutate`. Default `false`: an agent that connects can read,
	 * not write.
	 */
	mutations?: boolean;
	/**
	 * Browser origins (`https://app.example`) allowed to call the endpoint:
	 * their preflight is answered and their responses carry
	 * `Access-Control-Allow-Origin`. A request with no `Origin` header (a
	 * server, a CLI) is always allowed; a request with another origin is
	 * refused with a 403.
	 */
	allowedOrigins?: readonly string[];
	/**
	 * Hostnames (no port) a same-origin browser request may name in its `Host`
	 * header: the DNS-rebinding guard. Default `['localhost', '127.0.0.1',
	 * '[::1]']`. Set the public hostname(s) when the endpoint is not local.
	 */
	allowedHosts?: readonly string[];
	/**
	 * Receives an unexpected failure (a throwing `can`, a failing transport)
	 * with its cause; the agent only sees a generic message. Default
	 * `console.error`; `false` silences it.
	 */
	onError?: ((error: unknown) => void) | false;
}

/** What {@link createMcp} returns. */
export interface Mcp<HostCtx extends object = Record<never, never>> {
	/**
	 * Handles one MCP request (Streamable HTTP, stateless): a Web `Request` in,
	 * a `Response` out. Mount it in your own `Bun.serve` routes.
	 * `serverContext` goes to the `context` builder of every operation, like
	 * `graxia.fetch`'s; it is required when `HostCtx` has required keys.
	 * Never rejects.
	 */
	fetch(
		request: Request,
		...serverContext: ServerContextArg<HostCtx>
	): Promise<Response>;
	/**
	 * Where to serve {@link Mcp.metadata}: `/.well-known/oauth-protected-resource`
	 * plus the path of `auth.resource` (RFC 9728). `undefined` without `auth`.
	 */
	metadataPath: string | undefined;
	/**
	 * The protected resource metadata (RFC 9728) as a route handler: GET answers
	 * the JSON document (CORS `*`, cached an hour), another method 405. Without
	 * `auth` it answers 404.
	 */
	metadata(request: Request): Response;
	/** Stops the handler: in-flight requests are aborted. */
	close(): Promise<void>;
}

/**
 * The graxia instance a server is built over: it runs the operations
 * (`execute`), and gives the schema it serves and the limits it enforces.
 */
export type McpHost<HostCtx extends object> = Pick<
	Graxia<HostCtx>,
	'execute' | 'schema' | 'limits'
>;
