import { GraphQLError } from 'graphql';
import type { RequestState } from '../plugins/state';
import type { GraxiaPlugin, OnExecutePayload } from '../plugins/types';
import { clientAddressKey } from '../server/client-address';
import { httpRefusalKey } from '../server/http-refusal';
import { countFields, selectedOperation } from './count';
import { networkOf } from './ipv6';
import { type ResolvedRule, resolveFieldRateLimit } from './options';
import type { FieldRateLimitOptions } from './types';

const RETRY_MESSAGE = 'Too many requests, try again later.';

/** Seconds to wait: at least 1, the milliseconds rounded up; a value that is not finite is 1. */
function retrySeconds(ms: number): number {
	return Number.isFinite(ms) ? Math.max(1, Math.ceil(ms / 1000)) : 1;
}

/**
 * Per-field rate limits. Every selection of a limited field in the operation
 * about to run (aliases, inline fragments and fragment spreads expanded) is
 * one unit spent on that field's limit, keyed by the client. Past a limit
 * nothing executes: a 429 with `Retry-After`. A `single` field selected more
 * than once is refused with a 400. Counts queries, mutations and (once, at
 * subscribe) subscriptions, on every transport and in `graxia.execute`.
 *
 * @example
 * fieldRateLimit({
 *   fields: { signIn: memoryFieldLimit({ limit: 5, windowMs: 60_000 }) },
 * })
 * @throws {GraxiaConfigError} when the options are invalid.
 */
export function fieldRateLimit<Ctx extends object = any>(
	options: FieldRateLimitOptions<Ctx>,
): GraxiaPlugin<Ctx> {
	const { rules, key, ipv6Prefix, code } = resolveFieldRateLimit(options);
	const names: ReadonlySet<string> = new Set(rules.keys());

	const who = async (ctx: Ctx, state: RequestState) => {
		if (key) return key(ctx);
		const given = (ctx as { ip?: unknown }).ip;
		const address =
			typeof given === 'string' ? given : state.get(clientAddressKey);
		return address !== undefined && ipv6Prefix !== undefined
			? networkOf(address, ipv6Prefix)
			: address;
	};

	const refuse = (
		{ state, setResult }: OnExecutePayload<Ctx>,
		status: number,
		error: GraphQLError,
		headers?: Record<string, string>,
	) => {
		state.set(httpRefusalKey, { status, ...(headers ? { headers } : {}) });
		setResult({ errors: [error] });
	};

	async function run(payload: OnExecutePayload<Ctx>): Promise<void> {
		const { args, state } = payload;
		const operation = selectedOperation(args.document, args.operationName);
		if (!operation) return;
		const counted = countFields(args.document, operation, names);
		for (const [name, found] of counted) {
			if (rules.get(name)?.single && found.paths.length > 1)
				return refuse(
					payload,
					400,
					new GraphQLError(`${name} may be selected once per operation.`, {
						extensions: {
							code: 'FIELD_SELECTED_ONCE',
							fix: `Select ${name} once per operation, in a separate operation if you need it again.`,
						},
					}),
				);
		}
		if (counted.size === 0) return;
		const client = await who(args.contextValue, state);
		if (client === undefined) return;
		for (const [name, found] of counted) {
			const { limit } = rules.get(name) as ResolvedRule;
			const decision = Number.isFinite(found.count)
				? await limit.consume(`${name}:${client}`, found.count)
				: { allowed: false, retryAfter: Number.NaN };
			if (decision.allowed) continue;
			const seconds = retrySeconds(decision.retryAfter);
			return refuse(
				payload,
				429,
				new GraphQLError(RETRY_MESSAGE, {
					extensions: {
						code,
						retryAfter: seconds,
						fix: `Retry after ${seconds} seconds (see the Retry-After header).`,
					},
				}),
				{ 'retry-after': String(seconds), 'cache-control': 'no-store' },
			);
		}
	}

	return {
		name: 'field-rate-limit',
		enforce: 'pre',
		onExecute: run,
		onSubscribe: run,
	};
}
