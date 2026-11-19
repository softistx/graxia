/** What a verified access token says about its caller. */
export interface McpAuthInfo {
	/** Who the token is for (`sub`). */
	subject?: string | undefined;
	/** The OAuth client the token was issued to. */
	clientId?: string | undefined;
	/** The scopes the token carries. */
	scopes: readonly string[];
	/**
	 * When the token expires, in seconds since the epoch (the `exp` claim, not
	 * `Date.now()`). A past value is refused, and so is one that is not a finite
	 * number or looks like milliseconds.
	 */
	expiresAt?: number | undefined;
	/**
	 * The resource(s) the token was issued for (`aud`, RFC 8707). It must contain
	 * `auth.resource`; a token without it is refused, unless `auth.audience` is
	 * `'verifier'`.
	 */
	audience?: string | readonly string[] | undefined;
	/** Anything else your verifier wants to hand to `can` and `mcpAuth()` (roles, a tenant...). */
	extra?: Readonly<Record<string, unknown>> | undefined;
}

/** The scopes the server asks for: `read` for every call, `write` for `graphql_mutate`. */
export interface McpScopes {
	/** Default `mcp:read`. */
	read?: string;
	/** Default `mcp:write`. */
	write?: string;
}

/** The OAuth resource server settings of {@link McpOptions.auth}. */
export interface McpAuthOptions {
	/** The canonical URI of this MCP server (RFC 8707 / 9728): what tokens are issued for, e.g. `https://api.example.com/mcp`. */
	resource: string;
	/** Issuer URLs of the authorization servers that issue tokens for this resource; published in the metadata. */
	authorizationServers: readonly string[];
	/**
	 * Verifies a bearer token (a JWT signature, an introspection call, a
	 * lookup). Resolve the token's {@link McpAuthInfo}, or `undefined` for an
	 * invalid token (a 401), or a `Response` to answer as is (a verifier that
	 * builds its own refusals). A throw is an outage, not a bad token: it is a
	 * 503 with `Retry-After: 5` and reaches `onError`. Read the headers of
	 * `request` only, never its body.
	 */
	verifyToken: (
		token: string,
		request: Request,
	) =>
		| McpAuthInfo
		| Response
		| undefined
		| Promise<McpAuthInfo | Response | undefined>;
	/**
	 * Who checks the token's audience. Default `'resource'`: `verifyToken` must
	 * return `audience`, and it must contain `resource`. `'verifier'`: your
	 * verifier already refused a token issued for another resource, so nothing
	 * is checked here.
	 */
	audience?: 'resource' | 'verifier';
	/** The scopes to require; default `{ read: 'mcp:read', write: 'mcp:write' }`. */
	scopes?: McpScopes;
	/** `resource_name` of the metadata. */
	resourceName?: string;
	/** `resource_documentation` of the metadata (a URL). */
	documentation?: string;
}

/** {@link McpAuthOptions} with defaults applied and the metadata URL computed. */
export interface ResolvedAuth {
	options: McpAuthOptions;
	read: string;
	write: string;
	/** The absolute URL of the protected resource metadata (RFC 9728). */
	metadataUrl: string;
	/** Its path, for the route. */
	metadataPath: string;
}
