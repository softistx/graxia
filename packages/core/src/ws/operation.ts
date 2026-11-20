import type { StateBag } from '../plugins/state';
import type { GraphQLParams } from '../plugins/types';
import { runOperation } from '../server/operation';
import type { Runtime } from '../server/runtime';
import {
	preparePayload,
	streamOutcome,
	streamStop,
} from '../server/stream-response';
import { operationFormat, type ServerMessage } from './protocol';

/** What one operation needs from its connection. */
export interface OperationHost {
	rt: Runtime;
	/** The upgrade request and its state; each operation forks the state. */
	request: Request;
	state: StateBag;
	/** The host's context plus `connectionParams`. */
	serverContext: Record<string, unknown>;
	/** The client's `connection_init` payload, handed to the `context` factory. */
	connectionParams: Record<string, unknown> | undefined;
	/** Writes one message; resolves when the socket accepted it (backpressure). */
	send(message: ServerMessage | string): Promise<void>;
}

const decoder = new TextDecoder();

/**
 * Runs one `subscribe` message through the same pipeline as HTTP and writes
 * its messages: `next` per payload then `complete`, or one `error` when the
 * operation fails before it has a result (parse, validation, a refusing
 * plugin). `signal` aborts on the client's `complete`, the socket's close and
 * shutdown; then nothing more is written. Never rejects.
 */
export async function runSubscribe(
	host: OperationHost,
	id: string,
	params: GraphQLParams,
	signal: AbortSignal,
): Promise<void> {
	const { rt, send } = host;
	const state = host.state.fork();
	// The operation sees a request whose signal is the operation's own.
	const request = new Request(host.request, { signal });
	const fail = (errors: readonly unknown[]) =>
		signal.aborted ? undefined : send({ type: 'error', id, payload: errors });
	try {
		const outcome = await runOperation(rt, {
			request,
			state,
			params,
			serverContext: host.serverContext,
			connectionParams: host.connectionParams,
			method: 'POST',
			// A socket streams: subscriptions and incremental results are allowed.
			sse: true,
		});
		if (outcome.kind === 'response')
			return await fail([{ message: 'The operation was refused.' }]);
		if (outcome.kind === 'unexpected') {
			rt.unexpected.report(outcome.error, state, 'execution');
			return await fail(rt.unexpected.body(state).errors);
		}
		if (outcome.kind === 'result' && !hasData(outcome)) {
			// Same path as a payload over SSE: `onResultChunk`, then masking.
			const scope = outcome.scope ?? ((work) => work());
			const prepared = (await scope(() =>
				preparePayload(rt, request, state, outcome.result),
			)) as { errors?: readonly unknown[] } | null;
			const errors = prepared?.errors ?? [];
			// A hook may have dropped every error: never answer with an empty list.
			return await fail(
				errors.length > 0 ? errors : [{ message: 'The operation failed.' }],
			);
		}
		const stream = streamOutcome(
			rt,
			{ request, state },
			outcome,
			operationFormat(id),
			{
				stop: streamStop(rt, signal, outcome),
				clientGone: signal,
			},
		);
		for await (const bytes of stream.body) await send(decoder.decode(bytes));
		await stream.done;
	} catch (error) {
		rt.unexpected.report(error, state, 'execution');
		await Promise.resolve(fail(rt.unexpected.body(state).errors)).catch(
			() => {},
		);
	}
}

/** A result that ran (execution errors included) is a `next`; one without `data` or with a chosen status failed before. */
function hasData(outcome: {
	result: object;
	status?: number | undefined;
}): boolean {
	return outcome.status === undefined && 'data' in outcome.result;
}
