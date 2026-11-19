import { createMcpHandler } from '@modelcontextprotocol/server';
import { createContextCarrier } from './context';
import { corsOrigin, withCors } from './cors';
import type { Mcp, McpHost, McpOptions } from './options';
import { defaultHosts } from './origin';
import { admit, type PipelineSettings } from './pipeline';
import { refusal } from './refusal';
import { buildServer, forwardedHeaders } from './server';
import { createViewSource } from './view-cache';

/** The error sink: the option, `console.error` by default, never throwing. */
function sinkOf(option: McpOptions['onError']): (error: unknown) => void {
	if (option === false) return () => {};
	const sink =
		option ??
		((error: unknown) => console.error('[graxia/mcp] unexpected error', error));
	return (error) => {
		try {
			sink(error);
		} catch {}
	};
}

/**
 * Creates an MCP server over a graxia instance: Streamable HTTP, stateless,
 * with the generic tools `graphql_schema`, `graphql_query` and (with
 * `mutations: true`) `graphql_mutate`. Every operation runs through
 * `graxia.execute`, so limits, cost, trusted documents, masking and rate
 * limits apply; the schema and the body limit come from `graxia`. There is no
 * authentication here: put the endpoint behind your own, and use `can` for
 * permissions.
 *
 * @example
 * const mcp = createMcp(graxia, { name: 'library' });
 * Bun.serve({ routes: { '/mcp': (req, server) => mcp.fetch(req, { server }) }, fetch: graxia.fetch });
 */
export function createMcp<HostCtx extends object = Record<never, never>>(
	graxia: McpHost<HostCtx>,
	options: McpOptions<HostCtx>,
): Mcp<HostCtx> {
	const onError = sinkOf(options.onError);
	const settings: PipelineSettings = {
		allowedOrigins: options.allowedOrigins ?? [],
		allowedHosts: options.allowedHosts ?? defaultHosts(),
		maxBody: graxia.limits.bodyBytes,
	};
	const carrier = createContextCarrier();
	const views = createViewSource(graxia.schema, options.can);
	const handler = createMcpHandler(
		({ requestInfo }) => {
			const request = requestInfo as Request;
			const serverContext = carrier.current();
			return buildServer(options, {
				graxia,
				view: views(request, serverContext),
				serverContext,
				headers: forwardedHeaders(request),
				signal: request.signal,
				onError,
			});
		},
		{
			maxRequestBodySize: settings.maxBody,
			onerror: (error) => onError(error),
		},
	);
	return {
		async fetch(request, ...rest) {
			const cors = corsOrigin(request, settings.allowedOrigins);
			try {
				const admitted = await admit(request, settings);
				if (admitted instanceof Response) return withCors(admitted, cors);
				const response = await carrier.run((rest[0] ?? {}) as object, () =>
					handler.fetch(admitted),
				);
				return withCors(response, cors);
			} catch (error) {
				onError(error);
				return withCors(
					refusal(
						500,
						'The MCP server failed to handle the request.',
						'Retry later; check the server logs.',
					),
					cors,
				);
			}
		},
		close: () => handler.close(),
	};
}
