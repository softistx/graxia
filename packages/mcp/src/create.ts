import { GraxiaConfigError } from '@graxia/core';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { authenticate } from './auth/bearer';
import { metadataHandler } from './auth/metadata';
import { runAs } from './auth/principal';
import { resolveAuth } from './auth/resolve';
import { writeStepUp } from './auth/scopes';
import type { McpAuthOptions } from './auth/types';
import { createContextCarrier } from './context';
import { corsOrigin, withCors } from './cors';
import { buildOperationTools } from './operations/build';
import { operationsError, problem } from './operations/problems';
import type { OperationTool } from './operations/types';
import { createVisibleTools } from './operations/visible';
import type { Mcp, McpHost, McpOptions } from './options';
import { defaultHosts } from './origin';
import { admit, type PipelineSettings } from './pipeline';
import { refusal } from './refusal';
import { serverFactory } from './server';
import { createViewSource } from './view-cache';

/** The error sink: the option, `console.error` by default, never throwing. */
function sinkOf(option: McpOptions['onError']): (error: unknown) => void {
	if (option === false) return () => {};
	const sink =
		option ??
		((error: unknown) => {
			// The SDK reports a client's protocol mistakes too ("Rejected ..."); they are not ours.
			if (error instanceof Error && error.message.startsWith('Rejected '))
				return;
			console.error('[graxia/mcp] unexpected error', error);
		});
	return (error) => {
		try {
			sink(error);
		} catch {}
	};
}

/** The typed tools of `operations`, built once; `genericTools: false` needs at least one. */
function typedTools(
	graxia: McpHost<any>,
	options: McpOptions<any>,
	mutations: boolean,
): OperationTool[] {
	const generic = options.genericTools ?? true;
	if (!options.operations) {
		if (!generic)
			throw new GraxiaConfigError(
				'createMcp: genericTools is false and there is no operations: an agent would have nothing to call. Fix: pass operations: { documents: manifest }, or remove genericTools: false.',
			);
		return [];
	}
	const typed = buildOperationTools(
		graxia.schema,
		options.operations,
		mutations,
	);
	if (!generic && typed.length === 0) throw operationsError([problem.empty()]);
	return typed;
}

/**
 * Creates an MCP server over a graxia instance: Streamable HTTP, stateless,
 * with the generic tools `graphql_schema`, `graphql_query` and (with
 * `mutations: true`) `graphql_mutate`. Every operation runs through
 * `graxia.execute`, so limits, cost, trusted documents, masking and rate
 * limits apply; the schema and the body limit come from `graxia`. With
 * `operations`, each persisted operation is also a typed tool. Without
 * `auth` there is no authentication here: put the endpoint behind your own,
 * and use `can` for permissions. With `auth` it is an OAuth resource server
 * (bearer tokens, scopes, protected resource metadata), and `metadataPath`
 * is a string.
 *
 * @example
 * const mcp = createMcp(graxia, { name: 'library' });
 * Bun.serve({ routes: { '/mcp': (req, server) => mcp.fetch(req, { server }) }, fetch: graxia.fetch });
 */
export function createMcp<HostCtx extends object = Record<never, never>>(
	graxia: McpHost<HostCtx>,
	options: McpOptions<HostCtx> & { auth: McpAuthOptions },
): Mcp<HostCtx> & { metadataPath: string };
export function createMcp<HostCtx extends object = Record<never, never>>(
	graxia: McpHost<HostCtx>,
	options: McpOptions<HostCtx>,
): Mcp<HostCtx>;
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
	const auth = options.auth ? resolveAuth(options.auth) : undefined;
	const mutations = options.mutations ?? false;
	const carrier = createContextCarrier();
	const views = createViewSource(graxia.schema, options.can);
	const typed = typedTools(graxia, options, mutations);
	const writeTools = new Set([
		'graphql_mutate',
		...typed.filter((tool) => tool.kind === 'mutation').map((t) => t.name),
	]);
	const handler = createMcpHandler(
		serverFactory({
			graxia,
			options,
			auth,
			carrier,
			views,
			visibleTools: options.operations ? createVisibleTools(typed) : undefined,
			onError,
		}),
		{
			maxRequestBodySize: settings.maxBody,
			onerror: (error) => onError(error),
		},
	);
	return {
		metadataPath: auth?.metadataPath,
		metadata: metadataHandler(auth, mutations),
		async fetch(request, ...rest) {
			const cors = corsOrigin(request, settings.allowedOrigins);
			try {
				const admitted = await admit(
					request,
					settings,
					auth && ((r) => authenticate(r, auth, onError)),
				);
				if (admitted instanceof Response) return withCors(admitted, cors);
				const principal = admitted.gated;
				// With mutations off no scope opens a writing tool: the SDK answers tool-not-found.
				if (auth && principal && mutations) {
					const stepUp = await writeStepUp(
						admitted.request,
						auth,
						principal,
						writeTools,
					);
					if (stepUp) return withCors(stepUp, cors);
				}
				// authInfo is not passed to the SDK (mcpAuth() carries the principal), so its tool scopeChallenge is unused.
				const response = await carrier.run((rest[0] ?? {}) as object, () =>
					runAs(principal, () => handler.fetch(admitted.request)),
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
