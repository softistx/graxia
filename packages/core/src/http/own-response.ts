const created = new WeakSet<Response>();

/**
 * @internal Marks a Response graxia built for the request in flight, so
 * `seal` may set its headers in place. A Response from a plugin, a route, a
 * cache or user code is never marked: it may be shared across requests.
 */
export function own(response: Response): Response {
	created.add(response);
	return response;
}

/** @internal True once for a marked Response: the mark is spent, so a later request that gets hold of the same object has it rebuilt. */
export function takeOwn(response: Response): boolean {
	return created.delete(response);
}
