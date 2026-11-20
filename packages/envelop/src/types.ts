import type { Plugin } from '@envelop/core';
import type { GraphQLError } from 'graphql';

/** Any Envelop plugin, whatever context it declares. */
export type AnyPlugin = Plugin<any>;

/** An Envelop plugin with the label its errors use: `envelop plugin 2 of 4 (onParse, instrumentation)`. */
export interface Entry {
	plugin: AnyPlugin;
	label: string;
}

/** What the Envelop context held for one operation before graxia built its own. */
export interface Op {
	/** `{ request, params, ...what onEnveloped/onParse/onValidate extended }`, the `context` those hooks see. */
	readonly context: Record<PropertyKey, unknown>;
	/** The keys those hooks extended: they win over the host context in `onContext`. */
	readonly extended: Set<PropertyKey>;
	/** A `GraphQLError` an `onContextBuilding` hook raised: answered by `onExecute`/`onSubscribe`. */
	failure?: GraphQLError;
}

/** The graxia plugin's shared, read-only view of the adapted Envelop plugins. */
export interface Adapter {
	readonly entries: readonly Entry[];
	readonly errorHandlers: readonly ContextErrorHandler[];
}

export type ContextErrorHandler = (payload: {
	context: Readonly<Record<string, unknown>>;
	error: unknown;
	setError: (error: unknown) => void;
}) => void | Promise<void>;
