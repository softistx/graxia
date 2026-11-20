import type { Graxia, ServerContextArg } from '@graxia/core';
import type { Can } from '@graxia/core/agent';
import type { McpAuthInfo, McpAuthOptions } from './auth/types';
import type { McpOperationsOptions } from './operations/types';

/** Options of {@link createMcp}. */
export interface McpOptions<HostCtx extends object = Record<never, never>> {
	/** The MCP server name, sent to clients as `serverInfo.name`. */
	name: string;
	/** The MCP server version, sent as `serverInfo.version`. Default `'0.0.0'`. */
	version?: string;
	/** Server instructions the client shows to the model: what this API is for. */
	instructions?: string;
	/**
	 * A factory, called once per request: it returns the permission check
	 * (`Can`) for that caller, from the request (a token, a session), the
	 * `serverContext` you passed to `fetch` and the verified token when `auth`
	 * is set (`auth` is undefined otherwise). It may be async. Absent: every
	 * field is visible.
	 *
	 * @example
	 * can: async (request) => {
	 * 	const roles = await rolesOf(request);
	 * 	return (permission) => roles.has(permission);
	 * },
	 */
	can?: (
		request: Request,
		serverContext: HostCtx,
		auth?: McpAuthInfo,
	) => Can | Promise<Can>;
	/**
	 * Turn the endpoint into an OAuth 2.1 resource server: every request needs
	 * a bearer token your `verifyToken` accepts, issued for `resource`, with
	 * the read scope (`mcp:read`); `graphql_mutate` and the typed tools of
	 * mutations also need the write scope (`mcp:write`): without it they are
	 * not listed, and a call answers a 403 naming the tool. With `mutations`
	 * off they do not exist (`Tool … not found`).
	 * Serve `mcp.metadata` at `mcp.metadataPath`. Absent: no authentication
	 * here, put the endpoint behind your own.
	 */
	auth?: McpAuthOptions;
	/**
	 * List `graphql_mutate` and the typed tools of mutations. Default `false`:
	 * an agent that connects can read, not write.
	 */
	mutations?: boolean;
	/**
	 * Persisted operations as typed tools: each named operation of
	 * `operations.documents` is one tool (`BookById` is `book_by_id`) whose
	 * input schema comes from its variables and output schema from its
	 * selection set. An operation needs a description (its own, or
	 * `operations.descriptions`). A problem is a `GraxiaConfigError` at boot.
	 *
	 * @example
	 * createMcp(graxia, { name: 'library', operations: { documents: manifest } });
	 */
	operations?: McpOperationsOptions;
	/**
	 * List `graphql_query` and `graphql_mutate`. Default `true`. `false` keeps
	 * `graphql_schema` and the typed tools only, so an agent runs nothing but
	 * the operations you persisted; it needs `operations`. When graxia runs
	 * trusted documents in `strict` mode the two are never listed and a call
	 * is refused (`PERSISTED_QUERY_ONLY`), whatever this says.
	 */
	genericTools?: boolean;
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
	 * plus the path of `auth.resource` (RFC 9728). `undefined` without `auth`;
	 * `createMcp` types it `string` when it is given `auth`.
	 */
	metadataPath: string | undefined;
	/**
	 * The protected resource metadata (RFC 9728) as a route handler: GET answers
	 * the JSON document (CORS `*`, cached an hour), another method 405. Without
	 * `auth` it answers 404.
	 */
	metadata(request: Request): Response;
	/** Stops the handler: in-flight requests are aborted (like `graxia.dispose()`). */
	dispose(): Promise<void>;
}

/**
 * The graxia instance a server is built over: it runs the operations
 * (`execute`), and gives the schema it serves, the limits it enforces and
 * its trusted documents mode. A hand-made host must pass
 * `trustedDocuments: graxia.trustedDocuments`: leaving it out would let
 * strict trusted documents be switched off without a sign.
 */
export type McpHost<HostCtx extends object> = Pick<
	Graxia<HostCtx>,
	'execute' | 'schema' | 'limits' | 'trustedDocuments'
>;
