import type { Graxia, ServerContextArg } from '@graxia/core';
import type { GraphQLSchema } from 'graphql';

/** Whether the caller holds a permission named by `@needs` (what `printSchemaFor`'s `can` takes). */
export type Can = (permission: string) => boolean;

/** Options of {@link createMcp}. */
export interface McpOptions<HostCtx extends object = Record<never, never>> {
	/**
	 * The schema the graxia instance serves. The tools describe and validate
	 * against what the caller may see of it (`@needs` hides the rest).
	 */
	schema: GraphQLSchema;
	/** The MCP server name, sent to clients as `serverInfo.name`. */
	name: string;
	/** The MCP server version, sent as `serverInfo.version`. Default `'0.0.0'`. */
	version?: string;
	/** Server instructions the client shows to the model: what this API is for. */
	instructions?: string;
	/**
	 * The permissions of the caller, from the request (a token, a session) and
	 * the `serverContext` you passed to `fetch`. It may be async. Absent:
	 * every field is visible. This is the only access control of this
	 * package until OAuth lands: put the endpoint behind your own auth.
	 */
	can?: (request: Request, serverContext: HostCtx) => Can | Promise<Can>;
	/**
	 * List `graphql_mutate`. Default `false`: an agent that connects can read,
	 * not write.
	 */
	mutations?: boolean;
	/**
	 * Origins allowed besides the endpoint's own (a browser client on another
	 * origin). A request with no `Origin` header (a server, a CLI) is always
	 * allowed; a request with another origin is refused with a 403.
	 */
	allowedOrigins?: readonly string[];
	/**
	 * Largest POST body in bytes; a larger one is refused with a 413. Default
	 * `1048576`, graxia's own default `limits.bodyBytes`: set it to the same
	 * value as the instance's.
	 */
	maxBodyBytes?: number;
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
	/** Stops the handler: in-flight requests are aborted. */
	close(): Promise<void>;
}

/** The graxia instance a server is built over; only `execute` is used. */
export type McpHost<HostCtx extends object> = Pick<Graxia<HostCtx>, 'execute'>;
