import { refusal } from './refusal';

const TOO_LARGE = (max: number) =>
	refusal(
		413,
		`The request body is larger than ${max} bytes.`,
		'Send a smaller request, or raise limits.bodyBytes of the graxia instance (this endpoint enforces the same).',
	);

/**
 * Reads a POST body under `max` bytes. Returns a copy of the request whose
 * body is already in memory, or the 413 / 415 refusal.
 */
export async function boundedRequest(
	request: Request,
	max: number,
): Promise<Request | Response> {
	const type = request.headers.get('content-type') ?? '';
	if (!/^application\/json\s*(;|$)/i.test(type))
		return refusal(
			415,
			'The request body must be application/json.',
			'Send the JSON-RPC message with the header Content-Type: application/json.',
		);
	const declared = Number(request.headers.get('content-length'));
	if (declared > max) return TOO_LARGE(max);
	const chunks: Uint8Array[] = [];
	let size = 0;
	if (request.body) {
		for await (const chunk of request.body) {
			size += chunk.byteLength;
			if (size > max) return TOO_LARGE(max);
			chunks.push(chunk);
		}
	}
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return new Request(request.url, {
		method: request.method,
		headers: request.headers,
		body: bytes,
		signal: request.signal,
	});
}
