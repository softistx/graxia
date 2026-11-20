import { GraxiaConfigError } from '../errors/config-error';

/** Headers that satisfy CSRF prevention by default (a browser must preflight a request that carries one). */
export const DEFAULT_CSRF_HEADERS: readonly string[] = [
	'x-graphql-csrf',
	'graphql-require-preflight',
	'apollo-require-preflight',
	'x-apollo-operation-name',
];

/** How a request from another origin is treated once `sameOrigin` is on. */
export type CrossOrigin = 'refuse' | 'json' | 'allow';

/**
 * Why `csrf.sameOrigin` refused a request: `cross-origin` (an `Origin` that is not the server's own
 * or allowed), `null-origin` (`Origin: null`), or `no-origin` (there is no `Origin` header and
 * `Sec-Fetch-Site` is `cross-site` or `same-site`).
 */
export type OriginRefusalReason = 'cross-origin' | 'null-origin' | 'no-origin';

/** What `csrf.sameOrigin.onRefused` is told about a refusal. */
export interface OriginRefusal {
	reason: OriginRefusalReason;
	/** `true` for a WebSocket upgrade, `false` for an HTTP request. */
	websocket: boolean;
}

/** The `csrf.sameOrigin` option as an object. */
export interface SameOriginOptions {
	/** Origins (`https://app.example.com`: scheme, host, optional port, no path) treated as same-origin. */
	allowedOrigins?: readonly string[];
	/**
	 * What a request from another origin gets over HTTP: `refuse` (default) answers 403,
	 * `json` lets through only a preflighted request (a JSON body or a CSRF header), `allow` lets
	 * everything through. A WebSocket upgrade is always refused unless its origin is allowed.
	 */
	crossOrigin?: CrossOrigin;
	/**
	 * Called for every refused origin, a WebSocket upgrade's included (which an `Origin` check
	 * refuses even with `sameOrigin` off; `onRefused` does not apply there), with the request and
	 * an {@link OriginRefusal}. Return a `Response` to answer it yourself (a 404 to hide the
	 * endpoint, a per-route body); it gets `cache-control: no-store` unless it sets one. Return
	 * `undefined` (or anything that is not a `Response`) for the default 403 `FORBIDDEN_ORIGIN`.
	 * It may be async. A throw is an unexpected failure (a 500, reported to `onUnexpected`).
	 */
	onRefused?: (
		request: Request,
		info: OriginRefusal,
	) => Response | undefined | Promise<Response | undefined>;
}

/** The `csrf` option of `createGraxia`. */
export interface CsrfOptions {
	/**
	 * Refuses (403) a request a browser can send cross-site without a preflight
	 * (a GET, or a POST with a `text/plain`, form or multipart body) unless it carries one of
	 * these headers. `true` (default) uses {@link DEFAULT_CSRF_HEADERS}; a list replaces them;
	 * `false` turns the check off.
	 */
	requireHeader?: boolean | readonly string[];
	/** Checks the `Origin` header of HTTP requests. Off by default; `true` is `{ crossOrigin: 'refuse' }`. */
	sameOrigin?: boolean | SameOriginOptions;
}

/** @internal {@link CsrfOptions} with defaults applied. */
export interface ResolvedCsrf {
	/** Lower-case header names, or `false` when the header check is off. */
	headers: readonly string[] | false;
	/** Whether HTTP requests are checked by `Origin`. */
	sameOrigin: boolean;
	crossOrigin: CrossOrigin;
	allowedOrigins: ReadonlySet<string>;
	onRefused?: SameOriginOptions['onRefused'];
}

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function headerList(value: unknown): readonly string[] | false {
	if (value === undefined || value === true) return DEFAULT_CSRF_HEADERS;
	if (value === false) return false;
	const bad = () =>
		new GraxiaConfigError(
			'csrf.requireHeader must be a boolean or a non-empty list of header names',
		);
	if (!Array.isArray(value) || value.length === 0) throw bad();
	for (const name of value)
		if (typeof name !== 'string' || !TOKEN.test(name)) throw bad();
	return value.map((name: string) => name.toLowerCase());
}

function originOf(entry: unknown): string {
	const bad = () =>
		new GraxiaConfigError(
			`csrf.sameOrigin.allowedOrigins entry ${JSON.stringify(entry)} is not an origin (use scheme, host and optional port, no path: "https://app.example.com")`,
		);
	if (typeof entry !== 'string') throw bad();
	try {
		const { origin } = new URL(entry);
		if (origin === 'null' || origin !== entry) throw bad();
		return origin;
	} catch {
		throw bad();
	}
}

/**
 * Applies the defaults of {@link CsrfOptions}; `false` when `csrf` is `false`.
 * @throws {GraxiaConfigError} on an invalid value.
 */
export function resolveCsrf(csrf: unknown): ResolvedCsrf | false {
	if (csrf === false) return false;
	if (csrf !== undefined && (typeof csrf !== 'object' || csrf === null))
		throw new GraxiaConfigError(
			'csrf must be false or an object ({ requireHeader, sameOrigin })',
		);
	const { requireHeader, sameOrigin } = (csrf ?? {}) as CsrfOptions;
	const headers = headerList(requireHeader);
	const resolved = {
		headers,
		sameOrigin: false,
		crossOrigin: 'refuse' as CrossOrigin,
		allowedOrigins: new Set<string>(),
	};
	if (sameOrigin === undefined || sameOrigin === false)
		return resolved as ResolvedCsrf;
	if (sameOrigin === true) return { ...resolved, sameOrigin: true };
	if (typeof sameOrigin !== 'object' || sameOrigin === null)
		throw new GraxiaConfigError(
			'csrf.sameOrigin must be a boolean or an object ({ allowedOrigins, crossOrigin, onRefused })',
		);
	const { allowedOrigins = [], crossOrigin = 'refuse', onRefused } = sameOrigin;
	if (
		crossOrigin !== 'refuse' &&
		crossOrigin !== 'json' &&
		crossOrigin !== 'allow'
	)
		throw new GraxiaConfigError(
			'csrf.sameOrigin.crossOrigin must be "refuse", "json" or "allow"',
		);
	if (!Array.isArray(allowedOrigins))
		throw new GraxiaConfigError(
			'csrf.sameOrigin.allowedOrigins must be a list of origins (e.g. "https://app.example.com")',
		);
	if (onRefused !== undefined && typeof onRefused !== 'function')
		throw new GraxiaConfigError(
			'csrf.sameOrigin.onRefused must be a function ((request, { reason, websocket }) => Response | undefined)',
		);
	return {
		...resolved,
		sameOrigin: true,
		crossOrigin,
		allowedOrigins: new Set(allowedOrigins.map(originOf)),
		...(onRefused === undefined ? {} : { onRefused }),
	};
}

/** @internal The security options with defaults applied. */
export interface ResolvedSecurity {
	csrf: ResolvedCsrf | false;
	introspection: boolean;
	suggestions: boolean;
}

function flag(name: string, value: unknown, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== 'boolean')
		throw new GraxiaConfigError(`${name} must be a boolean`);
	return value;
}

/**
 * Applies the defaults of `csrf`, `introspection` and `suggestions`; the last two
 * follow `NODE_ENV` (off when it is `production`), read once here.
 * @throws {GraxiaConfigError} on an invalid value.
 */
export function resolveSecurity(options: {
	csrf?: unknown;
	introspection?: unknown;
	suggestions?: unknown;
}): ResolvedSecurity {
	const open = process.env['NODE_ENV'] !== 'production';
	return {
		csrf: resolveCsrf(options.csrf),
		introspection: flag('introspection', options.introspection, open),
		suggestions: flag('suggestions', options.suggestions, open),
	};
}
