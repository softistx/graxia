/** The two response encodings of a GraphQL result over HTTP. */
export type MediaType =
	| 'application/graphql-response+json'
	| 'application/json';

interface Range {
	type: string;
	q: number;
}

/** The types offered, in the order a tie between wildcards resolves to. */
const OFFERED: readonly MediaType[] = [
	'application/json',
	'application/graphql-response+json',
];

function parseRange(part: string): Range | undefined {
	const [type = '', ...params] = part.split(';').map((s) => s.trim());
	if (type === '') return undefined;
	let q = 1;
	for (const param of params) {
		const [name, value] = param.split('=').map((s) => s.trim());
		if (name?.toLowerCase() === 'q') {
			const parsed = Number(value);
			q = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
		}
	}
	return { type: type.toLowerCase(), q };
}

interface Candidate {
	media: MediaType;
	q: number;
	/** Index of the exact range, or `Infinity` when only a wildcard matched. */
	exact: number;
}

/** The q of one offered type: its own range wins, then `application/*`, then `*\/*`. */
function candidate(
	media: MediaType,
	ranges: readonly Range[],
): Candidate | undefined {
	const exact = ranges.findIndex((r) => r.type === media);
	if (exact >= 0) return { media, q: (ranges[exact] as Range).q, exact };
	const wild =
		ranges.find((r) => r.type === 'application/*') ??
		ranges.find((r) => r.type === '*/*');
	return wild
		? { media, q: wild.q, exact: Number.POSITIVE_INFINITY }
		: undefined;
}

/**
 * Picks the response media type from an `Accept` header.
 *
 * An absent or empty header gives `application/json`, as does `*\/*` or
 * `application/*` (the legacy type, which every client reads). The header's
 * q-values (clamped to 0..1) decide; an explicit `q=0` on a type excludes it
 * even when a wildcard would allow it. At equal q a type named exactly beats
 * a wildcard match, then the one listed first wins, then `application/json`.
 * Returns `undefined` when neither type is acceptable (answer 406).
 */
export function negotiate(accept: string | null): MediaType | undefined {
	if (accept === null || accept.trim() === '') return 'application/json';
	const ranges = accept
		.split(',')
		.map(parseRange)
		.filter((r): r is Range => r !== undefined);
	const found = OFFERED.flatMap((media) => {
		const c = candidate(media, ranges);
		return c && c.q > 0 ? [c] : [];
	});
	found.sort((a, b) => b.q - a.q || a.exact - b.exact);
	return found[0]?.media;
}

function prefers(accept: string | null, type: string): boolean {
	if (accept === null) return false;
	const ranges = accept
		.split(',')
		.map(parseRange)
		.filter((r): r is Range => r !== undefined);
	const stream = ranges.findIndex((r) => r.type === type);
	const wanted = ranges[stream];
	if (wanted === undefined || wanted.q <= 0) return false;
	const json = OFFERED.flatMap((media) => {
		const c = candidate(media, ranges);
		return c && c.q > 0 ? [c] : [];
	});
	return json.every(
		(c) => c.q < wanted.q || (c.q === wanted.q && c.exact > stream),
	);
}

/**
 * Whether an `Accept` header asks for a server-sent event stream: it names
 * `text/event-stream` (never through a wildcard) with a q above 0, and no
 * JSON type it names or matches ranks above it. At equal q the range listed
 * first wins, and a JSON type named exactly beats the stream only when listed
 * before it.
 */
export function prefersEventStream(accept: string | null): boolean {
	return prefers(accept, 'text/event-stream');
}

/**
 * Whether an `Accept` header asks for `multipart/mixed` (incremental delivery
 * over HTTP; its `deferSpec` and `subscriptionSpec` parameters are ignored),
 * under the same rules as {@link prefersEventStream}: never through a wildcard.
 */
export function prefersMultipart(accept: string | null): boolean {
	return prefers(accept, 'multipart/mixed');
}
