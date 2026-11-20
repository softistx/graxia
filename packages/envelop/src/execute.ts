import type {
	ExecutionOutput,
	GraxiaPlugin,
	OnExecuteDone,
	OnExecutePayload,
} from '@softistx/graxia';
import { GraphQLError } from 'graphql';
import type { opKey } from './early-context';
import {
	isAsyncIterable,
	mapPayloads,
	onceDone,
	onFailure,
	present,
	rebuild,
} from './results';
import type { Adapter, Entry } from './types';

type Key = ReturnType<typeof opKey>;
type Loose = any;

/** What differs between `onExecute` and `onSubscribe`: the names of the Envelop hooks and of their payload members. */
interface Kind {
	hook: 'onExecute' | 'onSubscribe';
	fn: 'executeFn' | 'subscribeFn';
	setFn: 'setExecuteFn' | 'setSubscribeFn';
	done: 'onExecuteDone' | 'onSubscribeResult';
	/** A query's incremental result is rebuilt from the payloads the hooks saw; a subscription stays a stream. */
	rebuilds: boolean;
}

const EXECUTE: Kind = {
	hook: 'onExecute',
	fn: 'executeFn',
	setFn: 'setExecuteFn',
	done: 'onExecuteDone',
	rebuilds: true,
};
const SUBSCRIBE: Kind = {
	hook: 'onSubscribe',
	fn: 'subscribeFn',
	setFn: 'setSubscribeFn',
	done: 'onSubscribeResult',
	rebuilds: false,
};

/** `onExecute` and `onSubscribe` of the adapter, with their done hooks as after-hooks. */
export function executeHooks(
	adapter: Adapter,
	key: Key,
): Pick<GraxiaPlugin, 'onExecute' | 'onSubscribe'> {
	const of = (kind: Kind) => {
		const entries = adapter.entries.filter((e) => e.plugin[kind.hook]);
		const asks = entries.length > 0 || adapter.entries.some(needsFailure);
		return asks
			? (payload: OnExecutePayload) => run(kind, entries, key, payload)
			: undefined;
	};
	const onExecute = of(EXECUTE);
	const onSubscribe = of(SUBSCRIBE);
	return {
		...(onExecute && { onExecute }),
		...(onSubscribe && { onSubscribe }),
	};
}

const needsFailure = (entry: Entry) => Boolean(entry.plugin.onContextBuilding);

async function run(
	kind: Kind,
	entries: readonly Entry[],
	key: Key,
	payload: OnExecutePayload,
): Promise<((done: OnExecuteDone) => Promise<void>) | undefined> {
	const failure = payload.state.get(key)?.failure;
	if (failure) {
		payload.setResult({ errors: [failure] });
		return undefined;
	}
	const { args } = payload;
	const context = args.contextValue as Record<string, unknown>;
	const initial = payload.executeFn;
	let fn = initial;
	let stopped: { result: ExecutionOutput } | undefined;
	const afters: Loose[] = [];
	try {
		for (const { plugin } of entries) {
			const after = await (plugin[kind.hook] as Loose)({
				[kind.fn]: fn,
				[kind.setFn]: (next: typeof fn) => {
					fn = next;
				},
				setResultAndStopExecution: (result: ExecutionOutput) => {
					stopped = { result };
				},
				args,
				context,
				extendContext: (extension: object) =>
					void Object.assign(context, extension),
			});
			if (after) afters.push(after);
			if (stopped) break;
		}
	} catch (error) {
		// A GraphQLError is the client's answer; anything else is unexpected.
		if (!(error instanceof GraphQLError)) throw error;
		payload.setResult({ errors: [error] });
		return undefined;
	}
	if (stopped) payload.setResult(stopped.result);
	else if (fn !== initial) payload.setExecuteFn(fn);
	return afters.length > 0
		? (done) => finish(kind, afters, done, args)
		: undefined;
}

async function finish(
	kind: Kind,
	afters: readonly Loose[],
	done: OnExecuteDone,
	args: object,
): Promise<void> {
	if (done.result === undefined) return;
	const original = present(done.result);
	let current = original;
	const nexts: Loose[] = [];
	const ends: (() => void)[] = [];
	for (const after of afters) {
		const hooked = await after[kind.done]?.({
			args,
			result: current,
			setResult: (next: unknown) => {
				current = next;
			},
		});
		if (hooked?.onNext) nexts.push(hooked.onNext);
		if (hooked?.onEnd) ends.push(hooked.onEnd);
	}
	if (nexts.length > 0 && isAsyncIterable(current))
		current = mapPayloads(current, async (payload) => {
			let result = payload;
			for (const onNext of nexts)
				await onNext({
					args,
					result,
					setResult: (next: unknown) => {
						result = next;
					},
				});
			return result;
		});
	if (ends.length > 0 && isAsyncIterable(current))
		current = onceDone(current, () => {
			for (const onEnd of ends) onEnd();
		});
	const handlers = afters.flatMap((a) =>
		a['onSubscribeError'] ? [a['onSubscribeError'] as (p: object) => void] : [],
	);
	if (handlers.length > 0 && isAsyncIterable(current))
		current = onFailure(current, (failure) => {
			let error = failure;
			for (const handler of handlers)
				handler({
					error,
					setError: (next: unknown) => {
						error = next;
					},
					context: (args as Loose)['contextValue'],
				});
			throw error;
		});
	if (current === original) return;
	done.setResult(kind.rebuilds ? await rebuild(current) : (current as never));
}
