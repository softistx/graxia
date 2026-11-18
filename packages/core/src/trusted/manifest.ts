import { GraxiaConfigError } from '../errors/config-error';
import { isRecord } from '../http/record';
import { hashOf } from './apq';

const APOLLO_FORMAT = 'apollo-persisted-query-manifest';

function entry(map: Map<string, string>, id: unknown, source: unknown): void {
	if (typeof id !== 'string' || id === '')
		throw new GraxiaConfigError(
			'trustedDocuments.manifest: every id must be a non-empty string',
		);
	if (typeof source !== 'string' || source.trim() === '')
		throw new GraxiaConfigError(
			`trustedDocuments.manifest: the entry "${id}" must map to a GraphQL source string`,
		);
	// A hash id is indexed in lower case, the way APQ clients send it.
	map.set(hashOf(id) === undefined ? id : id.toLowerCase(), source);
}

function fromApollo(manifest: Record<string, any>): Map<string, string> {
	if (manifest['version'] !== 1)
		throw new GraxiaConfigError(
			'trustedDocuments.manifest: the Apollo manifest "version" must be 1',
		);
	const { operations } = manifest;
	if (!Array.isArray(operations))
		throw new GraxiaConfigError(
			'trustedDocuments.manifest: the Apollo manifest "operations" must be a list of { id, body }',
		);
	const map = new Map<string, string>();
	for (const operation of operations) {
		if (!isRecord(operation))
			throw new GraxiaConfigError(
				'trustedDocuments.manifest: the Apollo manifest "operations" must be a list of { id, body }',
			);
		entry(map, operation['id'], operation['body']);
	}
	return map;
}

/**
 * Detects the format of a manifest (a `Map`, an Apollo persisted query
 * manifest, or a plain `{ id: source }` object as Relay and graphql-codegen
 * write it) and returns it as a map from id to source.
 * @throws {GraxiaConfigError} on a malformed manifest.
 */
export function normalizeManifest(
	manifest: unknown,
): ReadonlyMap<string, string> {
	if (manifest instanceof Map) {
		const map = new Map<string, string>();
		for (const [id, source] of manifest) entry(map, id, source);
		return map;
	}
	if (!isRecord(manifest))
		throw new GraxiaConfigError(
			'trustedDocuments.manifest must be a Map, an object of id to source, or an Apollo persisted query manifest',
		);
	if (manifest['format'] === APOLLO_FORMAT) return fromApollo(manifest);
	const map = new Map<string, string>();
	for (const [id, source] of Object.entries(manifest)) entry(map, id, source);
	return map;
}
