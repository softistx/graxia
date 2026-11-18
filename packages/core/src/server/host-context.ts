/**
 * The conditional types of the host context. `HostCtx` has a required key when
 * `{}` is not assignable to it: then `serverContext` is required everywhere it
 * can be passed (`fetch`, `execute`, `serve`, `createTestClient`).
 */

/** The `serverContext` argument list of `fetch`. */
export type ServerContextArg<HostCtx extends object> =
	// biome-ignore lint/complexity/noBannedTypes: `{}` is the "no required key" test.
	{} extends HostCtx ? [serverContext?: HostCtx] : [serverContext: HostCtx];

/** The `serverContext` property of an options object. */
export type WithServerContext<HostCtx extends object> =
	// biome-ignore lint/complexity/noBannedTypes: `{}` is the "no required key" test.
	{} extends HostCtx ? { serverContext?: HostCtx } : { serverContext: HostCtx };

/** An options argument carrying `serverContext`: the argument itself is required when `serverContext` is. */
export type OptionsArg<HostCtx extends object, Options extends object> =
	// biome-ignore lint/complexity/noBannedTypes: `{}` is the "no required key" test.
	{} extends HostCtx
		? [options?: Options & WithServerContext<HostCtx>]
		: [options: Options & WithServerContext<HostCtx>];
