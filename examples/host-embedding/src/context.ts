import type { ContextInit, InferContext } from '@softistx/graxia';

/** What the host collects while a resolver runs, and merges into the response afterwards. */
export interface ResponseSet {
	headers: Headers;
	cookies: Bun.CookieMap;
}

export const newResponseSet = (): ResponseSet => ({
	headers: new Headers(),
	cookies: new Bun.CookieMap(),
});

/** What the host passes to `graxia.fetch(request, hostContext)`. */
export interface HostContext {
	set: ResponseSet;
	/** Who is calling. The example reads a header; a real host reads its session. */
	user: string | undefined;
}

/** Builds the context of each operation: the host's `serverContext` is already in it. */
export const context = ({ serverContext }: ContextInit<HostContext>) => ({
	user: serverContext.user,
});

/** The context resolvers receive, written once: `set`, `user` and `signal`. */
export type Ctx = InferContext<typeof context>;
