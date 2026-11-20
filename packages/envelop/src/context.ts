import type { GraxiaPlugin, OnContextPayload } from '@graxia/core';
import { GraphQLError } from 'graphql';
import { extender, type opKey, opOf } from './early-context';
import * as refuse from './refuse';
import type { Adapter, Entry } from './types';

type Key = ReturnType<typeof opKey>;
type AfterContext = (payload: unknown) => unknown;

/**
 * `onParams` (Envelop's `onEnveloped`, once per operation) and `onContext`
 * (`onContextBuilding`, its after-hooks at the end) of the adapter. The
 * context the Envelop hooks build on is `{ request, params, ...the host
 * context }`; what they add is returned and merged into graxia's context.
 */
export function contextHooks(
	adapter: Adapter,
	key: Key,
): Pick<GraxiaPlugin, 'onParams' | 'onContext'> {
	const { entries } = adapter;
	const enveloped = entries.filter((e) => e.plugin.onEnveloped);
	const building = entries.filter((e) => e.plugin.onContextBuilding);
	const early =
		enveloped.length > 0 ||
		building.length > 0 ||
		entries.some(
			(e) =>
				e.plugin.onParse ||
				e.plugin.onValidate ||
				e.plugin.onExecute ||
				e.plugin.onSubscribe,
		);
	if (!early) return {};
	return {
		onParams: (payload) => {
			const op = opOf(key, payload.state, payload);
			const extendContext = extender(op);
			for (const entry of enveloped)
				entry.plugin.onEnveloped?.({
					context: op.context,
					extendContext,
					setSchema: () => {
						throw refuse.setSchema(entry.label);
					},
				});
		},
		onContext: (payload) => buildContext(adapter, building, key, payload),
	};
}

async function buildContext(
	adapter: Adapter,
	building: readonly Entry[],
	key: Key,
	payload: OnContextPayload,
): Promise<Record<PropertyKey, unknown>> {
	const op = opOf(key, payload.state, { request: payload.request, params: {} });
	const context: Record<PropertyKey, unknown> = {
		...op.context,
		...payload.context,
	};
	for (const k of op.extended) context[k] = op.context[k];
	const extendContext = (extension: object) =>
		void Object.assign(context, extension);
	try {
		const afters: AfterContext[] = [];
		let broken = false;
		for (const { plugin } of building) {
			if (broken) break;
			const after = await plugin.onContextBuilding?.({
				context: context as never,
				extendContext,
				breakContextBuilding: () => {
					broken = true;
				},
			});
			if (typeof after === 'function') afters.push(after as AfterContext);
		}
		if (!broken)
			for (const after of afters) await after({ context, extendContext });
	} catch (thrown) {
		let error = thrown;
		for (const handler of adapter.errorHandlers)
			await handler({
				context,
				error,
				setError: (next) => {
					error = next;
				},
			});
		// A GraphQLError is the client's answer, given by onExecute/onSubscribe.
		if (!(error instanceof GraphQLError)) throw error;
		op.failure = error;
	}
	return context;
}
