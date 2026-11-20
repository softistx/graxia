import { GraxiaConfigError } from '@softistx/graxia';

/** The hostname an `allowedHosts` entry should be, or `undefined` when it is already one. */
function hostnameOf(entry: string): string | undefined {
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry)) {
		const url = URL.parse(entry);
		return url
			? url.hostname
			: entry.replace(/^[^/]*\/\//, '').split(/[/:]/)[0];
	}
	if (entry.includes('/')) return entry.split('/')[0]?.replace(/:\d+$/, '');
	if (/^\[.*\](:\d+)$/.test(entry)) return entry.replace(/:\d+$/, '');
	if (
		!entry.startsWith('[') &&
		entry.split(':').length === 2 &&
		/:\d+$/.test(entry)
	)
		return entry.replace(/:\d+$/, '');
	return undefined;
}

/** The exact origin an `allowedOrigins` entry should be, or `undefined` when it is already one. */
function originOf(entry: string): string | undefined {
	const url = URL.parse(entry);
	if (!url || url.origin === 'null') return undefined;
	return url.origin === entry ? undefined : url.origin;
}

/**
 * Checks `allowedHosts` and `allowedOrigins` once, at `createMcp`: an entry
 * the request check could never match (a host with a port, a scheme or a
 * path; an origin with a trailing slash or a path) would only show up as a
 * 403 on every browser call.
 * @throws {GraxiaConfigError} naming the entry and the corrected value.
 */
export function checkOriginOptions(
	allowedHosts: readonly string[] | undefined,
	allowedOrigins: readonly string[] | undefined,
): void {
	for (const entry of allowedHosts ?? []) {
		const fixed = hostnameOf(entry);
		if (fixed !== undefined)
			throw new GraxiaConfigError(
				`createMcp: allowedHosts entry "${entry}" can never match: it is a hostname without scheme, port or path. Fix: use "${fixed}".`,
			);
	}
	for (const entry of allowedOrigins ?? []) {
		const fixed = originOf(entry);
		if (fixed !== undefined)
			throw new GraxiaConfigError(
				`createMcp: allowedOrigins entry "${entry}" can never match: an origin is exactly scheme://host[:port], no path and no trailing slash. Fix: use "${fixed}".`,
			);
		if (!URL.canParse(entry))
			throw new GraxiaConfigError(
				`createMcp: allowedOrigins entry "${entry}" is not an origin. Fix: use scheme://host[:port], e.g. "https://app.example".`,
			);
	}
}
