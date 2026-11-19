import { createMcpHandler } from '@modelcontextprotocol/server';
import { boundedRequest } from './body';
import type { Can, Mcp, McpHost, McpOptions } from './options';
import { checkOrigin } from './origin';
import { refusal } from './refusal';
import { buildServer, forwardedHeaders, type RequestContext } from './server';
import { buildView, type View } from './view';

const DEFAULT_BODY_BYTES = 1 << 20;

/** Carries the request's `serverContext` to the per-request factory: the SDK may clone the request, so an object key would miss. */
export const CONTEXT_HEADER = 'x-graxia-mcp-context';

interface Pending {
	serverContext: object;
}

/**
 * Creates an MCP server over a graxia instance: Streamable HTTP, stateless,
 * with the generic tools `graphql_schema`, `graphql_query` and (with
 * `mutations: true`) `graphql_mutate`. Every operation runs through
 * `graxia.execute`, so limits, cost, trusted documents, masking and rate
 * limits apply. There is no authentication here: put the endpoint behind
 * your own, and use `can` for permissions.
 *
 * @example
 * const mcp = createMcp(graxia, { schema, name: 'library' });
 * Bun.serve({ routes: { '/mcp': (req, server) => mcp.fetch(req, { server }) }, fetch: graxia.fetch });
 */
export function createMcp<HostCtx extends object = Record<never, never>>(
	graxia: McpHost<HostCtx>,
	options: McpOptions<HostCtx>,
): Mcp<HostCtx> {
	const allowed = options.allowedOrigins ?? [];
	const maxBody = options.maxBodyBytes ?? DEFAULT_BODY_BYTES;
	if (!Number.isInteger(maxBody) || maxBody < 1)
		throw new TypeError('createMcp: maxBodyBytes must be a positive integer');
	const pending = new Map<string, Pending>();
	let shared: View | undefined;
	const viewOf = async (request: Request, serverContext: object) => {
		if (!options.can) {
			shared ??= buildView(options.schema);
			return shared;
		}
		const can: Can = await options.can(request, serverContext as HostCtx);
		return buildView(options.schema, can);
	};
	const handler = createMcpHandler(
		async ({ requestInfo }) => {
			const request = requestInfo as Request;
			const serverContext =
				pending.get(request.headers.get(CONTEXT_HEADER) ?? '')?.serverContext ??
				{};
			const context: RequestContext = {
				graxia,
				view: await viewOf(request, serverContext),
				serverContext,
				headers: forwardedHeaders(request),
				signal: request.signal,
			};
			return buildServer(options, context);
		},
		{ maxRequestBodySize: maxBody },
	);
	return {
		async fetch(request, ...rest) {
			try {
				return await serve(request, (rest[0] ?? {}) as object);
			} catch {
				return refusal(
					500,
					'The MCP server failed to handle the request.',
					'Retry later; check the server logs.',
				);
			}
		},
		close: () => handler.close(),
	};

	async function serve(request: Request, serverContext: object) {
		const forbidden = checkOrigin(request, allowed);
		if (forbidden) return forbidden;
		if (request.method !== 'POST')
			return refusal(
				405,
				`${request.method} is not supported: this endpoint is stateless.`,
				'Send the JSON-RPC message with POST. There is no server-initiated stream to open or session to close.',
				{ allow: 'POST' },
			);
		const bounded = await boundedRequest(request, maxBody);
		if (bounded instanceof Response) return bounded;
		const id = crypto.randomUUID();
		bounded.headers.set(CONTEXT_HEADER, id);
		pending.set(id, { serverContext });
		try {
			return await handler.fetch(bounded);
		} finally {
			pending.delete(id);
		}
	}
}
