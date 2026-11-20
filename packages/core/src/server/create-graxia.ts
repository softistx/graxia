import type { GraphQLSchema } from 'graphql';
import { resolveLimits } from '../document/parse';
import { createPluginEngine } from '../plugins/engine';
import type { RequirePluginContext } from '../plugins/requirement';
import { StateBag } from '../plugins/state';
import type { GraxiaPlugin } from '../plugins/types';
import { exposeCsrfHeader } from '../security/header-key';
import { createTelemetry } from '../telemetry';
import { resolveTrusted } from '../trusted/options';
import { createDispose } from './dispose';
import { createEntry } from './entry';
import { createExecute } from './execute';
import type {
	CoreContext,
	NeededContext,
	RequireContext,
} from './infer-context';
import type { Graxia } from './instance';
import { createLifecycle } from './lifecycle';
import type { GraxiaOptions, NoPlugins } from './options';
import { resolve } from './resolve-options';
import { buildRuntime } from './runtime';
import type { GraxiaServeOptions, GraxiaSocketData } from './serve-options';
import { createUnexpectedHandler } from './unexpected';

export type { Graxia } from './instance';
export type { GraxiaServeOptions, GraxiaSocketData };

/** The options `createGraxia` takes: the schema's and every plugin's needed context are checked against the host `HostCtx`. */
type CheckedOptions<
	HostCtx extends object,
	Schema extends GraphQLSchema,
	Plugins extends readonly GraxiaPlugin<any, any>[],
	Made extends NeededContext<Schema, HostCtx, Plugins>,
> = GraxiaOptions<HostCtx, Schema, Plugins, Made> &
	RequireContext<NeededContext<Schema, HostCtx, Plugins>, HostCtx> &
	RequirePluginContext<Plugins, HostCtx & CoreContext & Made>;

/**
 * Creates a graxia server over `schema`: GraphQL over HTTP on Bun.
 *
 * - **Direct**, `createGraxia({ ... })`: the host context is read from the
 *   `context` factory (`ContextInit<Host>` on its `init`).
 * - **Curried**, `createGraxia<Host>()({ ... })`: the host is explicit while the
 *   schema, the plugins and the factory's result stay inferred, so the schema's
 *   needed context and every plugin's required context are still checked.
 *   TypeScript cannot take `Host` explicitly and infer the rest in one call
 *   (no partial type-argument inference), hence the two calls, as in
 *   `definePlugin<In>()({ ... })`.
 *
 * `createGraxia<Host>({ ... })` (a type argument on the direct call) turns
 * inference off and skips both checks: use the curried form.
 *
 * @example
 * const graxia = createGraxia({ schema });
 * graxia.serve({ port: 3000 }); // or: Bun.serve({ fetch: graxia.fetch })
 *
 * @example Curried, the host typed explicitly
 * const graxia = createGraxia<{ db: Db }>()({ schema, context: ({ serverContext }) => ({ db: serverContext.db }) });
 */
export function createGraxia<HostCtx extends object = Record<never, never>>(): <
	Schema extends GraphQLSchema = GraphQLSchema,
	const Plugins extends readonly GraxiaPlugin<any, any>[] = NoPlugins,
	Made extends NeededContext<Schema, HostCtx, Plugins> = NeededContext<
		Schema,
		HostCtx,
		Plugins
	>,
>(
	options: CheckedOptions<HostCtx, Schema, Plugins, Made>,
) => Graxia<HostCtx>;
// last on purpose: Parameters/ReturnType<typeof createGraxia> read the last overload
export function createGraxia<
	HostCtx extends object = Record<never, never>,
	Schema extends GraphQLSchema = GraphQLSchema,
	const Plugins extends readonly GraxiaPlugin<any, any>[] = NoPlugins,
	Made extends NeededContext<Schema, HostCtx, Plugins> = NeededContext<
		Schema,
		HostCtx,
		Plugins
	>,
>(options: CheckedOptions<HostCtx, Schema, Plugins, Made>): Graxia<HostCtx>;
export function createGraxia(
	options?: GraxiaOptions<any, GraphQLSchema, any, any>,
): unknown {
	if (options === undefined) {
		return (curried: GraxiaOptions<any, GraphQLSchema, any, any>) =>
			build(curried);
	}
	return build(options);
}

function build<HostCtx extends object>(
	options: GraxiaOptions<HostCtx, GraphQLSchema, any, any>,
): Graxia<HostCtx> {
	const resolved = resolve(options);
	const documentLimits = resolveLimits(options.limits);
	const trusted = resolveTrusted(options.trustedDocuments);
	// Before `engine.init()`: a bad option throws before any plugin's setup runs.
	const telemetry = createTelemetry(options.telemetry, options.schema);
	const lifecycle = createLifecycle();
	const servers: Bun.Server<GraxiaSocketData>[] = [];
	const engine = createPluginEngine(
		options.plugins ?? [],
		{
			sse: resolved.sse,
			ws: resolved.ws !== false,
		},
		options.schema,
	);
	const ready = engine.init();
	// Handled here so a failing `setup` is never an unhandled rejection; reported once.
	ready.catch(() => {});
	const unexpected = createUnexpectedHandler(options.onUnexpected);
	ready.catch((error: unknown) =>
		unexpected.report(error, new StateBag(), 'setup'),
	);
	const rt = buildRuntime(options, {
		resolved,
		trusted,
		telemetry,
		engine,
		unexpected,
		lifecycle,
		ready,
	});
	const entry = createEntry<HostCtx>(rt, servers);
	const dispose = createDispose({
		lifecycle,
		engine,
		ready,
		servers,
		unexpected: rt.unexpected,
		timeout: resolved.shutdownTimeout,
	});
	const execute = createExecute({
		run: entry.handleWith,
		lifecycle,
		path: resolved.path,
	});
	const graxia: Graxia<HostCtx> = {
		schema: options.schema,
		limits: {
			bodyBytes: resolved.bodyBytes,
			tokens: documentLimits.tokens,
		},
		trustedDocuments: trusted && { mode: trusted.mode },
		ready,
		execute,
		fetch: entry.fetch,
		serve: entry.serve,
		upgrade: entry.upgrade,
		isUpgrade: entry.isUpgrade,
		websocket: entry.websocket,
		dispose,
		[Symbol.asyncDispose]: () => dispose(),
	};
	exposeCsrfHeader(graxia, resolved.csrf);
	return graxia;
}
