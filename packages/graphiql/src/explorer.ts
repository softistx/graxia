import { GraxiaConfigError } from '@graxia/core';

/** The plugin names the two explorers register under. */
export const GRAPHIQL = 'graphiql';
export const SANDBOX = 'apollo-sandbox';

/** The `enabled` option: a flag, or a function that decides for each request. */
export type Enabled = boolean | ((request: Request) => boolean);

/** What `enabled` resolved to: whether the plugin installs, and whether it answers one request. */
export interface Gate {
	readonly on: boolean;
	readonly allows: (request: Request) => boolean;
}

/**
 * Resolve `enabled`: explicit, else `NODE_ENV !== 'production'`. A function
 * installs the plugin and is called once per request the explorer would
 * answer (the answer is kept for that request, so the CSRF check and the
 * handler agree). Any other value is a configuration error.
 */
export function resolveEnabled(enabled: unknown): Gate {
	if (typeof enabled === 'function') {
		const decide = enabled as (request: Request) => boolean;
		const seen = new WeakMap<Request, boolean>();
		return {
			on: true,
			allows(request) {
				let answer = seen.get(request);
				if (answer === undefined) {
					answer = Boolean(decide(request));
					seen.set(request, answer);
				}
				return answer;
			},
		};
	}
	if (enabled !== undefined && typeof enabled !== 'boolean')
		throw new GraxiaConfigError(
			`enabled must be a boolean or a function (request: Request) => boolean, got ${typeof enabled}. Write enabled: true, enabled: false or enabled: () => myDevFlag.`,
		);
	return {
		on: enabled ?? process.env['NODE_ENV'] !== 'production',
		allows: () => true,
	};
}

/**
 * The plugin name: a disabled explorer carries a suffix, so that a disabled
 * one never counts as installed (`[graphiql(), apolloSandbox({ enabled: false })]`).
 */
export function explorerName(name: string, enabled: boolean): string {
	return enabled ? name : `${name} (disabled)`;
}

/**
 * Both explorers answer the same `GET`: two enabled ones cannot share an
 * endpoint, so the first explorer's `setup` to run refuses it at startup, naming the fix.
 */
export function assertSingleExplorer(
	self: string,
	plugins: readonly string[],
): void {
	const other = self === GRAPHIQL ? SANDBOX : GRAPHIQL;
	if (plugins.includes(other))
		throw new GraxiaConfigError(
			'graphiql() and apolloSandbox() are both enabled: they answer the same GET. Install one, or set enabled: false on the other.',
		);
}

/**
 * Whether a request asks for the explorer page: a `GET` that accepts
 * `text/html` and carries no `query`, `extensions` or `documentId`.
 */
export function isPageRequest(request: Request): boolean {
	if (request.method !== 'GET') return false;
	const { searchParams } = new URL(request.url);
	if (
		searchParams.has('query') ||
		searchParams.has('extensions') ||
		searchParams.has('documentId')
	)
		return false;
	return (request.headers.get('accept') ?? '').includes('text/html');
}

/** An HTML page response with the security headers both explorers share. */
export function pageResponse(html: string, csp: string): Response {
	return new Response(html, {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'content-security-policy': csp,
			'x-frame-options': 'DENY',
			'referrer-policy': 'no-referrer',
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff',
		},
	});
}
