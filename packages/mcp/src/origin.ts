import {
	localhostAllowedHostnames,
	validateHostHeader,
} from '@modelcontextprotocol/server';
import { refusal } from './refusal';

/** The allow-lists of the DNS-rebinding guard. */
export interface OriginPolicy {
	allowedOrigins: readonly string[];
	/** Hostnames without port; IPv6 in brackets. */
	allowedHosts: readonly string[];
}

/** The hostnames allowed by default: the local ones. */
export const defaultHosts = (): string[] => localhostAllowedHostnames();

/**
 * The DNS-rebinding guard of the MCP spec. A request that carries an
 * `Origin` passes only if the origin is in `allowedOrigins`, or it is the
 * endpoint's own origin and the `Host` header names an `allowedHosts`
 * hostname (an attacker's rebound domain is same-origin with itself, and
 * fails there). No `Origin` (a server, a CLI) passes. Returns the refusal,
 * or `undefined`.
 */
export function checkOrigin(
	request: Request,
	policy: OriginPolicy,
): Response | undefined {
	const origin = request.headers.get('origin');
	if (origin === null || policy.allowedOrigins.includes(origin))
		return undefined;
	const url = new URL(request.url);
	if (origin !== url.origin)
		return refusal(
			403,
			`Origin ${origin} is not allowed.`,
			`Add ${JSON.stringify(origin)} to createMcp's allowedOrigins, or call the endpoint without a browser Origin.`,
		);
	const host = request.headers.get('host') ?? url.host;
	const checked = validateHostHeader(host, [...policy.allowedHosts]);
	if (checked.ok) return undefined;
	return refusal(
		403,
		`Host ${host} is not allowed.`,
		`Add ${JSON.stringify(checked.hostname ?? host)} to createMcp's allowedHosts (hostnames without port). Behind a proxy, list the public hostname.`,
	);
}
