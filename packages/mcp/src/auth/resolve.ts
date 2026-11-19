import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/server';
import type { McpAuthOptions, ResolvedAuth } from './types';

/** Validates `auth` once, at `createMcp`, and derives what every request needs. */
export function resolveAuth(options: McpAuthOptions): ResolvedAuth {
	let url: URL;
	try {
		url = new URL(options.resource);
	} catch {
		throw new Error(
			`createMcp: auth.resource must be an absolute URL (got "${options.resource}"). Fix: pass the public URL of the MCP endpoint, e.g. https://api.example.com/mcp.`,
		);
	}
	if (options.authorizationServers.length === 0)
		throw new Error(
			'createMcp: auth.authorizationServers is empty. Fix: list the issuer URL of the authorization server that issues the tokens.',
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
