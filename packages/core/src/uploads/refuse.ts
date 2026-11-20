import { refusal } from '../http/respond';

const INVALID_FIX =
	'Send "operations" (JSON), then "map" (JSON: file field name → array of paths such as "variables.file"), then one part per file, as the GraphQL multipart request spec says.';
const LARGE_FIX =
	'Send smaller files, or raise uploads.bodyBytes / uploads.fileBytes on the server.';

/** 415: a multipart body while `uploads` is off. */
export const notEnabled = (): Response =>
	refusal(
		415,
		'File uploads (multipart/form-data) are not enabled on this server.',
		'Send the body as JSON with "Content-Type: application/json", or enable uploads on the server: createGraxia({ uploads: true }).',
		{ code: 'UPLOADS_NOT_ENABLED' },
	);

/** 413: a body, a file or the `operations` field over its limit. */
export const tooLarge = (
	what: string,
	option: string,
	bytes: number,
): Response =>
	refusal(
		413,
		`${what} is larger than ${option} (${bytes} bytes).`,
		LARGE_FIX,
		{ code: 'UPLOAD_TOO_LARGE' },
	);

/** 413: more file parts than `uploads.files`. */
export const tooMany = (count: number, limit: number): Response =>
	refusal(
		413,
		`The request holds ${count} files; uploads.files allows ${limit}.`,
		'Send fewer files per request, or raise uploads.files on the server.',
		{ code: 'UPLOAD_TOO_MANY_FILES' },
	);

/** 400: the multipart request breaks the spec. */
export const invalid = (message: string): Response =>
	refusal(400, message, INVALID_FIX, { code: 'UPLOAD_INVALID' });
