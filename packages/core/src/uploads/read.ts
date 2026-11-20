import { readBytes } from '../http/body';
import type { ResolvedUploads } from './options';
import { invalid, tooLarge, tooMany } from './refuse';

/** The text fields and file parts of a multipart body, within the limits. */
export type Parts =
	| { response: Response }
	| { operations: string; map: string; files: Map<string, File> };

/** Whether a `Content-Type` is `multipart/form-data`. */
export function isMultipart(contentType: string | null): boolean {
	return (
		contentType !== null &&
		(contentType.split(';')[0] ?? '').trim().toLowerCase() ===
			'multipart/form-data'
	);
}

/**
 * Reads and parses a multipart body: `Content-Length` first, the stream
 * counted and cancelled past `uploads.bodyBytes`, then the part count and each
 * file's size, all before any part reaches a resolver. `operationsBytes` is
 * `limits.bodyBytes`, the limit of the `operations` field.
 */
export async function readParts(
	request: Request,
	uploads: ResolvedUploads,
	operationsBytes: number,
): Promise<Parts> {
	const body = await readBytes(request, uploads.bodyBytes);
	if (body.kind === 'too-large')
		return {
			response: tooLarge(
				'The request body',
				'uploads.bodyBytes',
				uploads.bodyBytes,
			),
		};
	if (body.kind === 'invalid')
		return { response: invalid('The multipart body could not be parsed.') };
	let form: FormData;
	try {
		form = await new Response(body.bytes as BodyInit, {
			headers: { 'content-type': request.headers.get('content-type') ?? '' },
		}).formData();
	} catch {
		return { response: invalid('The multipart body could not be parsed.') };
	}
	return split(form, uploads, operationsBytes);
}

function split(
	form: FormData,
	uploads: ResolvedUploads,
	operationsBytes: number,
): Parts {
	const files = new Map<string, File>();
	let count = 0;
	for (const [name, value] of entriesOf(form)) {
		if (!(value instanceof File)) continue;
		count += 1;
		if (count > uploads.files)
			return { response: tooMany(countFiles(form), uploads.files) };
		if (value.size > uploads.fileBytes)
			return {
				response: tooLarge(
					`File "${name}"`,
					'uploads.fileBytes',
					uploads.fileBytes,
				),
			};
		if (!files.has(name)) files.set(name, value);
	}
	const operations = form.get('operations');
	if (typeof operations !== 'string')
		return {
			response: invalid('The multipart request has no "operations" field.'),
		};
	if (new TextEncoder().encode(operations).byteLength > operationsBytes)
		return {
			response: tooLarge(
				'The "operations" field',
				'limits.bodyBytes',
				operationsBytes,
			),
		};
	const map = form.get('map');
	if (typeof map !== 'string')
		return { response: invalid('The multipart request has no "map" field.') };
	return { operations, map, files };
}

function countFiles(form: FormData): number {
	let count = 0;
	for (const [, value] of form.entries())
		if (typeof value !== 'string') count += 1;
	return count;
}

/** Decodes a JSON text field, or `undefined` when it is not valid JSON. */
export function decode(text: string): { value: unknown } | undefined {
	try {
		return { value: JSON.parse(text) };
	} catch {
		return undefined;
	}
}

/** The entries of a form; Bun types them as strings, a file part is a `File`. */
const entriesOf = (form: FormData): IterableIterator<[string, unknown]> =>
	form.entries() as IterableIterator<[string, unknown]>;
