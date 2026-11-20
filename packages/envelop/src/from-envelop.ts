import type { Plugin as EnvelopPlugin } from '@envelop/core';
import type { Empty, GraxiaPlugin } from '@graxia/core';
import { contextHooks } from './context';
import { documentHooks } from './document';
import { opKey } from './early-context';
import { executeHooks } from './execute';
import { flatten } from './init';
import * as refuse from './refuse';

/** Options of {@link fromEnvelop}. */
export interface FromEnvelopOptions {
	/** The graxia plugin's name (default `envelop`). Two adapters in one instance need distinct names. */
	name?: string;
	/** Where the adapter runs among the other plugins. */
	enforce?: 'pre' | 'post';
}

/**
 * Runs Envelop plugins inside graxia as one graxia plugin.
 *
 * Every Envelop hook graxia can honour is mapped onto its own stages; any
 * other hook (`instrumentation`, a graphql-yoga hook, an unknown name) is
 * refused here, at boot, with a `GraxiaConfigError` that says what to write
 * instead. `Added` is what the plugins put in the context (unchecked).
 *
 * @example
 * createGraxia({
 *   schema,
 *   plugins: [fromEnvelop([useDepthLimit({ maxDepth: 10 })])],
 * }).serve();
 */
export function fromEnvelop<Added extends object = Empty>(
	plugins: readonly (EnvelopPlugin<any> | false | null | undefined)[],
	options: FromEnvelopOptions = {},
): GraxiaPlugin<Empty, Added> {
	const adapter = flatten(plugins);
	const key = opKey();
	const plugin: GraxiaPlugin<Empty, Empty> = {
		name: options.name ?? 'envelop',
		...(options.enforce && { enforce: options.enforce }),
		setup({ schema }) {
			for (const { plugin: p, label } of adapter.entries)
				p.onSchemaChange?.({
					schema,
					replaceSchema: () => {
						throw refuse.replaceSchema(label);
					},
				});
		},
		...contextHooks(adapter, key),
		...documentHooks(adapter, key),
		...executeHooks(adapter, key),
	};
	return plugin as GraxiaPlugin<Empty, Added>;
}
