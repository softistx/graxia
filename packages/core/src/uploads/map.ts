import { isRecord } from '../http/record';

/** The `map` field, validated: file field name → paths. */
export type FileMap = Record<string, string[]>;

export type MapResult = { ok: true } | { ok: false; message: string };

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const INDEX = /^(0|[1-9]\d{0,8})$/;

/** Validates the decoded `map` field: an object of field names to non-empty arrays of strings. */
export function parseMap(
	value: unknown,
): { ok: true; map: FileMap } | { ok: false; message: string } {
	const bad = {
		ok: false as const,
		message:
			'The "map" field must be a JSON object of file field names to arrays of paths.',
	};
	if (!isRecord(value)) return bad;
	const map: FileMap = Object.create(null);
	for (const [name, paths] of Object.entries(value)) {
		if (
			!Array.isArray(paths) ||
			paths.length === 0 ||
			!paths.every((path) => typeof path === 'string')
		)
			return bad;
		map[name] = paths;
	}
	return { ok: true, map };
}

/**
 * Sets each mapped file into `operations` (a decoded operation, or an array
 * of them for a batch) at its paths, and refuses anything else. Only own
 * properties and array indexes are followed; a path must start under
 * `variables` (`<index>.variables` in a batch) and end on a `null` slot.
 * Nothing is ever read from or written to a prototype.
 */
export function placeFiles(
	operations: unknown,
	map: FileMap,
	files: ReadonlyMap<string, File>,
): MapResult {
	for (const name of Object.keys(map))
		if (!files.has(name)) return fail(`Map entry "${name}" has no file part.`);
	for (const name of files.keys())
		if (!Object.hasOwn(map, name))
			return fail(`File part "${name}" is not in "map".`);
	for (const [name, paths] of Object.entries(map)) {
		const file = files.get(name) as File;
		for (const path of paths) {
			const failure = place(operations, name, path, file);
			if (failure) return fail(failure);
		}
	}
	return { ok: true };
}

const fail = (message: string): MapResult => ({ ok: false, message });

function place(
	operations: unknown,
	name: string,
	path: string,
	file: File,
): string | undefined {
	const segments = path.split('.');
	let node: unknown = operations;
	if (Array.isArray(operations)) {
		const index = segments.shift() ?? '';
		node = INDEX.test(index) ? operations[Number(index)] : undefined;
	}
	const head = `Map entry "${name}" points at "${path}"`;
	if (segments[0] !== 'variables' || segments.length < 2 || !isRecord(node))
		return `${head}; a file may only go under "variables".`;
	for (const segment of segments)
		if (FORBIDDEN.has(segment))
			return `Map entry "${name}" path "${path}" is not allowed.`;
	const notNull = `${head}, which is not null in "operations".`;
	const last = segments.length - 1;
	for (const [position, segment] of segments.entries()) {
		if (!isContainer(node)) return notNull;
		const key = keyOf(node, segment);
		if (key === undefined) return notNull;
		if (position === last) {
			if ((node as Record<string, unknown>)[key] !== null) return notNull;
			(node as Record<string, unknown>)[key] = file;
			return undefined;
		}
		node = (node as Record<string, unknown>)[key];
	}
	return notNull;
}

const isContainer = (value: unknown): value is object =>
	typeof value === 'object' && value !== null;

/** The own key or array index `segment` names on `node`, else `undefined`. */
function keyOf(node: object, segment: string): string | undefined {
	if (Array.isArray(node))
		return INDEX.test(segment) && Number(segment) < node.length
			? segment
			: undefined;
	return Object.hasOwn(node, segment) ? segment : undefined;
}
