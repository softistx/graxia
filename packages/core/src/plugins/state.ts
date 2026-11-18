import { GraxiaConfigError } from '../errors/config-error';

/** A typed key into a {@link RequestState}. Create one with {@link createStateKey}. */
export interface StateKey<T> {
	/** Human-readable name, used in error messages only. */
	readonly name: string;
	/** @internal unique identity; two keys with the same name are distinct. */
	readonly id: symbol;
	/** @internal phantom type carrier. */
	readonly '~type'?: T;
}

/**
 * Creates a typed state key. Keys are unique: two keys with the same name do
 * not collide.
 *
 * @example
 * const userKey = createStateKey<{ id: string }>("user");
 */
export function createStateKey<T>(name: string): StateKey<T> {
	return { name, id: Symbol(name) };
}

/** Per-request typed bag shared by every hook of one request. */
export class RequestState {
	/**
	 * Headers added to whatever response the request ends with (a plugin's
	 * `respond`, a 413, the result), merged by the transport.
	 */
	readonly responseHeaders: Headers;
	readonly #map = new Map<symbol, unknown>();
	readonly #parent: RequestState | undefined;

	/** @param parent internal: use {@link RequestState.fork}. */
	constructor(parent?: RequestState) {
		this.#parent = parent;
		this.responseHeaders = parent ? parent.responseHeaders : new Headers();
	}

	/**
	 * A child state for one operation (a single request or one batch entry):
	 * reads fall through to this state, writes stay in the child, and
	 * `responseHeaders` is shared. Two forks never see each other's writes.
	 */
	fork(): RequestState {
		return new RequestState(this);
	}

	/** Stores a value under the key. */
	set<T>(key: StateKey<T>, value: T): void {
		this.#map.set(key.id, value);
	}

	/** Reads the value, or `undefined` when none was set. */
	get<T>(key: StateKey<T>): T | undefined {
		return (
			this.#map.has(key.id) ? this.#map.get(key.id) : this.#parent?.get(key)
		) as T | undefined;
	}

	/** Whether a value was set under the key. */
	has(key: StateKey<unknown>): boolean {
		return this.#map.has(key.id) || (this.#parent?.has(key) ?? false);
	}

	/** Reads the value; throws {@link GraxiaConfigError} naming the key when absent. */
	require<T>(key: StateKey<T>): T {
		if (!this.has(key)) {
			throw new GraxiaConfigError(
				`Request state key "${key.name}" is required but was not set`,
			);
		}
		return this.get(key) as T;
	}
}
