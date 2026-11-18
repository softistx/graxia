/** The lowercase hex SHA-256 of `text`, the `sha256Hash` of an automatic persisted query. */
export function sha256Hex(text: string): string {
	return new Bun.CryptoHasher('sha256').update(text).digest('hex');
}

const HASH = /^(?:sha256:)?([0-9a-f]{64})$/i;

/** The lowercase hex of an id that is a SHA-256 (`<hex>` or `sha256:<hex>`), else `undefined`. */
export function hashOf(id: string): string | undefined {
	return HASH.exec(id)?.[1]?.toLowerCase();
}

/** The manifest keys tried for an id: as given, then the `<hex>` / `sha256:<hex>` counterpart of a hash. */
export function manifestKeys(id: string): string[] {
	const hex = hashOf(id);
	if (hex === undefined) return [id];
	return [...new Set([id, hex, `sha256:${hex}`])];
}

/** The key of an id in the store: a hash is the same key whether it came as `<hex>` or `sha256:<hex>`. */
export function storeKey(id: string): string {
	return `pq:${hashOf(id) ?? id}`;
}
