/** Outcome of reading a request body under a byte limit. */
export type BodyResult =
	| { kind: 'text'; text: string }
	| { kind: 'too-large' }
	| { kind: 'invalid'; message: string };

/** Default body limit: 1 MiB. */
export const DEFAULT_BODY_BYTES = 1 << 20;

/** Outcome of reading a request body as bytes under a limit. */
export type BytesResult =
	| { kind: 'bytes'; bytes: Uint8Array }
	| { kind: 'too-large' }
	| { kind: 'invalid'; message: string };

/**
 * Reads a request body as bytes, never holding more than `limit` of them.
 *
 * `Content-Length` is checked first so an honest oversized request is refused
 * without reading it, but it is never trusted alone: the stream is counted and
 * cancelled the moment it passes `limit`, whatever the header said.
 */
export async function readBytes(
	request: Request,
	limit: number,
): Promise<BytesResult> {
	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > limit) {
		void request.body?.cancel().catch(() => {});
		return { kind: 'too-large' };
	}
	if (request.body === null) return { kind: 'bytes', bytes: new Uint8Array() };
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel().catch(() => {});
				return { kind: 'too-large' };
			}
			chunks.push(value);
		}
	} catch {
		return { kind: 'invalid', message: 'The request body could not be read.' };
	}
	return { kind: 'bytes', bytes: concat(chunks, total) };
}

/** Reads a request body as UTF-8 text under `limit` bytes (see {@link readBytes}). */
export async function readBody(
	request: Request,
	limit: number,
): Promise<BodyResult> {
	const read = await readBytes(request, limit);
	if (read.kind !== 'bytes') return read;
	try {
		return {
			kind: 'text',
			text: new TextDecoder('utf-8', { fatal: true }).decode(read.bytes),
		};
	} catch {
		return { kind: 'invalid', message: 'The request body is not valid UTF-8.' };
	}
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

/**
 * Whether a `Content-Type` is `application/json` in UTF-8 (the charset
 * parameter is optional).
 */
export function isJsonContentType(contentType: string | null): boolean {
	if (contentType === null) return false;
	const [type = '', ...params] = contentType.split(';').map((s) => s.trim());
	if (type.toLowerCase() !== 'application/json') return false;
	for (const param of params) {
		const [name, value] = param.split('=').map((s) => s.trim());
		if (name?.toLowerCase() === 'charset')
			return value?.replace(/"/g, '').toLowerCase() === 'utf-8';
	}
	return true;
}
