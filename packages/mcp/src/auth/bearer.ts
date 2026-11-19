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

/** The 503 of a verifier that threw: an outage is never a 401. */
const unavailable = (): Response =>
	refusal(
		503,
		'The access token could not be verified: the token verifier failed.',
		'Retry in a few seconds with the same token. If it persists, the server owner should read the error onError received.',
		{ 'retry-after': '5' },
	);

/** Seconds since the epoch stay under this for millennia; above it the value is milliseconds. */
const MAX_EXPIRES_AT = 1e11;

/**
 * What the verifier's answer is refused for, if anything: a shape the
 * verifier got wrong (also sent to `onError`), an expired token, an audience
 * that is not this resource, a missing read scope.
 */
function refusalOf(
	info: McpAuthInfo,
	auth: ResolvedAuth,
	onError: (error: unknown) => void,
): Response | undefined {
	const { resource } = auth.options;
	const renew = `Get a new access token from the authorization server (see ${auth.metadataUrl}) and retry.`;
	const owner = (what: string, fix: string) => {
		onError(new Error(`createMcp: ${what}. Fix: ${fix}`));
		return 'Retry later; the server owner has to correct its token verifier (the error went to onError).';
	};
	if (!Array.isArray(info.scopes))
		return unauthorized(
			auth,
			'the verifier returned no scopes',
			owner(
				'verifyToken must return scopes',
				'return { scopes: [...] }, the list of scopes the token carries (an empty list for none).',
			),
		);
	const { expiresAt } = info;
	if (expiresAt !== undefined) {
		if (!Number.isFinite(expiresAt) || expiresAt > MAX_EXPIRES_AT)
			return unauthorized(
				auth,
				'the verifier returned an unusable expiry (expiresAt is in seconds)',
				owner(
					`verifyToken returned expiresAt ${String(expiresAt)}, and expiresAt is in seconds since the epoch`,
					'return the exp claim as is, or Math.floor(date.getTime() / 1000); leave it out when the token has no expiry.',
				),
			);
		if (expiresAt <= Date.now() / 1000)
			return unauthorized(auth, 'the access token has expired', renew);
	}
	if (auth.options.audience !== 'verifier') {
		const forResource = `Get an access token issued for ${resource} (the "resource" parameter of the authorization and token requests, RFC 8707) and retry.`;
		if (info.audience === undefined)
			return unauthorized(
				auth,
				'the access token carries no audience',
				`${forResource} Server owner: return audience from verifyToken, or set auth.audience to 'verifier' when the verifier checks it itself.`,
			);
		const audiences =
			typeof info.audience === 'string' ? [info.audience] : info.audience;
		if (!audiences.some((a) => sameResource(a, resource)))
			return unauthorized(
				auth,
				'the access token was issued for another resource',
				forResource,
			);
	}
	if (!info.scopes.includes(auth.read))
		return insufficient(auth, [auth.read], `the token lacks ${auth.read}`);
	return undefined;
}

/**
 * The bearer gate: resolves the verified token's info, or the answer to send
 * instead (400 token in the query string, 401 missing or invalid token, 403
 * missing read scope, 503 failing verifier, or the verifier's own `Response`).
 * Runs before the body is read.
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
	let verified: McpAuthInfo | Response | undefined;
	try {
		verified = await auth.options.verifyToken(token, request);
	} catch (error) {
		onError(error);
		return unavailable();
	}
	if (verified instanceof Response) return verified;
	if (verified === undefined)
		return unauthorized(
			auth,
			'the access token is invalid',
			`Get a new access token from the authorization server (see ${auth.metadataUrl}) and retry.`,
		);
	return refusalOf(verified, auth, onError) ?? verified;
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
