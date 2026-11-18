import { type MediaType, negotiate } from '../http/negotiate';
import { jsonResponse } from '../http/respond';

/** A 403 security refusal: `no-store`, a code and a `fix`, in the negotiated media type. */
export function forbidden(
	request: Request,
	message: string,
	code: string,
	fix: string,
): Response {
	const media: MediaType =
		negotiate(request.headers.get('accept')) ?? 'application/json';
	const body = { errors: [{ message, extensions: { code, fix } }] };
	return jsonResponse(body, 403, media, { 'cache-control': 'no-store' });
}
