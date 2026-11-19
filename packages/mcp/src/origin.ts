import { refusal } from './refusal';

/**
 * The DNS-rebinding guard of the MCP spec: a request that carries an `Origin`
 * must come from the endpoint's own origin or from `allowed`. No `Origin`
 * (a server, a CLI) passes. Returns the refusal, or `undefined`.
 */
export function checkOrigin(
	request: Request,
	allowed: readonly string[],
): Response | undefined {
	const origin = request.headers.get('origin');
	if (origin === null) return undefined;
	if (origin === new URL(request.url).origin || allowed.includes(origin))
		return undefined;
	return refusal(
		403,
		`Origin ${origin} is not allowed.`,
		`Add ${JSON.stringify(origin)} to createMcp's allowedOrigins, or call the endpoint without a browser Origin. Behind a proxy that rewrites the host, list the public origin too.`,
	);
}
