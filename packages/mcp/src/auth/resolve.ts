import { GraxiaConfigError } from '@graxia/core';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/server';
import type { McpAuthOptions, ResolvedAuth } from './types';

/** Validates `auth` once, at `createMcp`, and derives what every request needs. */
export function resolveAuth(options: McpAuthOptions): ResolvedAuth {
	let url: URL;
	try {
		url = new URL(options.resource);
	} catch {
		throw new GraxiaConfigError(
			`createMcp: auth.resource must be an absolute URL (got "${options.resource}"). Fix: pass the public URL of the MCP endpoint, e.g. https://api.example.com/mcp.`,
		);
	}
	if (url.hash !== '' || url.search !== '' || /[?#]$/.test(options.resource))
		throw new GraxiaConfigError(
			`createMcp: auth.resource must have no query and no fragment (got "${options.resource}"). Fix: pass the URL of the MCP endpoint alone, e.g. ${url.origin}${url.pathname}.`,
		);
	if (options.authorizationServers.length === 0)
		throw new GraxiaConfigError(
			'createMcp: auth.authorizationServers is empty. Fix: list the issuer URL of the authorization server that issues the tokens.',
		);
	for (const server of options.authorizationServers)
		if (!URL.canParse(server))
			throw new GraxiaConfigError(
				`createMcp: auth.authorizationServers must hold absolute URLs (got "${server}"). Fix: pass the issuer URL of the authorization server, e.g. https://auth.example.com.`,
			);
	const metadataUrl = getOAuthProtectedResourceMetadataUrl(url);
	return {
		options,
		read: options.scopes?.read ?? 'mcp:read',
		write: options.scopes?.write ?? 'mcp:write',
		metadataUrl,
		metadataPath: new URL(metadataUrl).pathname,
	};
}
