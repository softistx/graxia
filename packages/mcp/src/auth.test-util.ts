import { mcpFor, rpc } from './fixtures.test-util';
import type { McpAuthInfo, McpOptions } from './index';

export const RESOURCE = 'https://api.example.com/mcp';
export const META =
	'https://api.example.com/.well-known/oauth-protected-resource/mcp';
const future = Math.floor(Date.now() / 1000) + 3600;

export const tokens: Record<string, McpAuthInfo> = {
	read: {
		subject: 'u1',
		clientId: 'c1',
		scopes: ['mcp:read'],
		expiresAt: future,
		audience: RESOURCE,
	},
	both: {
		subject: 'u2',
		scopes: ['mcp:read', 'mcp:write'],
		expiresAt: future,
		audience: RESOURCE,
	},
	write: { scopes: ['mcp:write'], expiresAt: future, audience: RESOURCE },
	expired: { scopes: ['mcp:read'], expiresAt: 1, audience: RESOURCE },
	other: { scopes: ['mcp:read'], audience: 'https://other.example.com/mcp' },
	aud: { scopes: ['mcp:read'], audience: [`${RESOURCE}/`] },
};

export const seen: { errors: unknown[]; verified: number } = {
	errors: [],
	verified: 0,
};

export function authed(extra: Partial<McpOptions> = {}) {
	return mcpFor({
		mutations: true,
		onError: (e) => void seen.errors.push(e),
		auth: {
			resource: RESOURCE,
			authorizationServers: ['https://auth.example.com'],
			resourceName: 'Library',
			documentation: 'https://docs.example.com',
			verifyToken: (token) => {
				seen.verified++;
				if (token === 'boom') throw new Error('introspection down');
				return tokens[token];
			},
		},
		...extra,
	});
}
export const parse = (text: string) =>
	JSON.parse(
		text.startsWith('event:')
			? (text.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5)
			: text,
	);
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
export const fetchAs = (
	mcp: { fetch(r: Request): Promise<Response> },
	token: string,
) => mcp.fetch(rpc('tools/list', {}, bearer(token)));
