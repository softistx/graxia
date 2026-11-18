/** The two response encodings of a GraphQL result over HTTP. */
export type MediaType =
	| 'application/graphql-response+json'
	| 'application/json';

interface Range {
	type: string;
	q: number;
	order: number;
}

function parseRange(part: string, order: number): Range | undefined {
	const [type = '', ...params] = part.split(';').map((s) => s.trim());
	if (type === '') return undefined;
	let q = 1;
	for (const param of params) {
		const [name, value] = param.split('=').map((s) => s.trim());
		if (name?.toLowerCase() === 'q') {
			const parsed = Number(value);
			q = Number.isFinite(parsed) ? parsed : 0;
		}
	}
	return { type: type.toLowerCase(), q, order };
}

/**
 * Picks the response media type from an `Accept` header.
 *
 * An absent or empty header gives `application/json`, as does `*\/*` or
 * `application/*` (the legacy type, which every client reads). The header's
 * q-values decide; at equal q the more specific range wins, then the first
 * listed. Returns `undefined` when neither type is acceptable (answer 406).
 */
export function negotiate(accept: string | null): MediaType | undefined {
	if (accept === null || accept.trim() === '') return 'application/json';
	const ranges = accept
		.split(',')
		.map((part, i) => parseRange(part, i))
		.filter((r): r is Range => r !== undefined && r.q > 0);
	let best:
		| { media: MediaType; q: number; specific: boolean; order: number }
		| undefined;
	for (const range of ranges) {
		const media: MediaType | undefined =
			range.type === 'application/graphql-response+json'
				? 'application/graphql-response+json'
				: range.type === 'application/json' ||
						range.type === 'application/*' ||
						range.type === '*/*'
					? 'application/json'
					: undefined;
		if (media === undefined) continue;
		const specific = range.type === media;
		if (
			best === undefined ||
			range.q > best.q ||
			(range.q === best.q && specific && !best.specific)
		) {
			best = { media, q: range.q, specific, order: range.order };
		}
	}
	return best?.media;
}
