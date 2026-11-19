import { refusal } from '../refusal';
import type { McpAuthInfo, ResolvedAuth } from './types';

/** `WWW-Authenticate: Bearer ...` with the metadata URL, per RFC 6750 and 9728. */
export function challenge(
	auth: ResolvedAuth,
	params: { error?: string; description?: string; scope?: string },
): string {
	const parts: string[] = [];
	if (params.error) parts.push(`error="${params.error}"`);
	if (params.description)
		parts.push(`error_description="${params.description}"`);
	parts.push(`resource_metadata="${auth.metadataUrl}"`);
	if (params.scope) parts.push(`scope="${params.scope}"`);
	return `Bearer ${parts.join(', ')}`;
}

const bearerOf = (request: Request): string | undefined => {
	const match = /^Bearer\s+(\S+)\s*$/i.exec(
		request.headers.get('authorization') ?? '',
	);
	return match?.[1];
};

/** Compares resource identifiers ignoring a fragment and one trailing slash (RFC 8707). */
const sameResource = (a: string, b: string): boolean => {
	const clean = (s: string) => s.replace(/#.*$/, '').replace(/\/$/, '');
	return clean(a) === clean(b);
};

const unauthorized = (
	auth: ResolvedAuth,
	description: string,
	fix: string,
): Response =>
	refusal(
		401,
		`Unauthorized: ${description}.`,
		fix,
		{
			'www-authenticate': challenge(auth, {
				error: 'invalid_token',
				description,
			}),
		},
		'MCP_UNAUTHORIZED',
	);

/**
 * The bearer gate: resolves the verified token's info, or the refusal (400
 * token in the query string, 401 missing or invalid token, 403 missing read
 * scope). Runs before the body is read.
 */
export async function authenticate(
	request: Request,
	auth: ResolvedAuth,
	onError: (error: unknown) => void,
): Promise<McpAuthInfo | Response> {
	if (new URL(request.url).searchParams.has('access_token'))
		return refusal(
			400,
			'The access token is in the query string.',
			'Send the token in the header Authorization: Bearer <token>; a token in a URL is refused.',
			{ 'www-authenticate': challenge(auth, { error: 'invalid_request' }) },
			'MCP_TOKEN_IN_URL',
		);
	const token = bearerOf(request);
	if (token === undefined)
		return refusal(
			401,
			'Unauthorized: no bearer token.',
			`Send Authorization: Bearer <token>. Fetch the authorization server from ${auth.metadataUrl}, get a token with the scope ${auth.read}, and retry.`,
			{ 'www-authenticate': challenge(auth, { scope: auth.read }) },
			'MCP_UNAUTHORIZED',
		);
	let info: McpAuthInfo | undefined;
	try {
		info = await auth.options.verifyToken(token, request);
	} catch (error) {
		onError(error);
	}
	const invalid = (why: string) =>
		unauthorized(
			auth,
			why,
			`Get a new access token from the authorization server (see ${auth.metadataUrl}) and retry.`,
		);
	if (info === undefined) return invalid('the access token is invalid');
	if (info.expiresAt !== undefined && info.expiresAt <= Date.now() / 1000)
		return invalid('the access token has expired');
	if (info.audience !== undefined) {
		const audiences =
			typeof info.audience === 'string' ? [info.audience] : info.audience;
		if (!audiences.some((a) => sameResource(a, auth.options.resource)))
			return invalid('the access token was issued for another resource');
	}
	if (!info.scopes.includes(auth.read))
		return insufficient(auth, [auth.read], `the token lacks ${auth.read}`);
	return info;
}

/** The 403 `insufficient_scope` answer, naming the full scope set the token needs. */
export function insufficient(
	auth: ResolvedAuth,
	scopes: readonly string[],
	description: string,
): Response {
	const scope = scopes.join(' ');
	return refusal(
		403,
		`Forbidden: ${description}.`,
		`Ask the authorization server for a token with the scope${scopes.length > 1 ? 's' : ''} "${scope}" (see ${auth.metadataUrl}), then retry.`,
		{
			'www-authenticate': challenge(auth, {
				error: 'insufficient_scope',
				description,
				scope,
			}),
		},
		'MCP_INSUFFICIENT_SCOPE',
	);
}
