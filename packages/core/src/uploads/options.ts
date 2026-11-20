import { GraxiaConfigError } from '../errors/config-error';
import type { ResolvedCsrf } from '../security/options';

/** The `uploads` option of `createGraxia`: limits of a multipart request. */
export interface UploadsOptions {
	/** Most bytes of the whole multipart body. 16 MiB by default; more answers 413 `UPLOAD_TOO_LARGE`. */
	bodyBytes?: number;
	/** Most bytes of one file. 8 MiB by default (never more than `bodyBytes`). */
	fileBytes?: number;
	/** Most file parts in one request. 10 by default; more answers 413 `UPLOAD_TOO_MANY_FILES`. */
	files?: number;
}

/** @internal {@link UploadsOptions} with defaults applied. */
export interface ResolvedUploads {
	bodyBytes: number;
	fileBytes: number;
	files: number;
}

/** Default most bytes of a multipart body: 16 MiB. */
export const DEFAULT_UPLOAD_BODY_BYTES = 16 << 20;
/** Default most bytes of one file: 8 MiB. */
export const DEFAULT_UPLOAD_FILE_BYTES = 8 << 20;
/** Default most files in one request. */
export const DEFAULT_UPLOAD_FILES = 10;

const positive = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 1;

/**
 * Applies the defaults of `uploads`; `false` when it is off.
 * @throws {GraxiaConfigError} on an invalid value, or when the CSRF header check is off.
 */
export function resolveUploads(
	uploads: unknown,
	csrf: ResolvedCsrf | false,
): { uploads: ResolvedUploads | false } {
	if (uploads === undefined || uploads === false) return { uploads: false };
	if (
		uploads !== true &&
		(typeof uploads !== 'object' || uploads === null || Array.isArray(uploads))
	)
		throw new GraxiaConfigError(
			'uploads must be a boolean or an object ({ bodyBytes, fileBytes, files })',
		);
	const given: UploadsOptions = uploads === true ? {} : uploads;
	const bodyBytes = given.bodyBytes ?? DEFAULT_UPLOAD_BODY_BYTES;
	if (!positive(bodyBytes))
		throw new GraxiaConfigError('uploads.bodyBytes must be a positive integer');
	const fileBytes =
		given.fileBytes ?? Math.min(DEFAULT_UPLOAD_FILE_BYTES, bodyBytes);
	if (!positive(fileBytes) || fileBytes > bodyBytes)
		throw new GraxiaConfigError(
			'uploads.fileBytes must be a positive integer no larger than uploads.bodyBytes',
		);
	const files = given.files ?? DEFAULT_UPLOAD_FILES;
	if (!positive(files))
		throw new GraxiaConfigError('uploads.files must be a positive integer');
	if (csrf === false || csrf.headers === false)
		throw new GraxiaConfigError(
			'uploads need CSRF prevention: a browser can post multipart/form-data cross-site without a preflight. Keep csrf.requireHeader on (the default), or turn uploads off.',
		);
	return { uploads: { bodyBytes, fileBytes, files } };
}
