import { insufficient } from './bearer';
import type { McpAuthInfo, ResolvedAuth } from './types';

/** Whether the token may call the tools that write (`graphql_mutate`, a mutation's typed tool). */
export const canWrite = (auth: ResolvedAuth, info: McpAuthInfo): boolean =>
	info.scopes.includes(auth.write);

/**
 * Step-up: a read-only token that calls a tool that writes (`graphql_mutate`
 * or a mutation's typed tool, from a stale tool list) gets the 403
 * `insufficient_scope` naming `read write`, so a client can re-authorize.
 * `writes` says whether the write scope would open the tool to this caller:
 * a tool the caller's view hides gets no 403, so it answers like an unknown
 * one. Only when the server has mutations on: otherwise no scope would help,
 * and the call gets the SDK's tool-not-found.
 */
export async function writeStepUp(
	auth: ResolvedAuth,
	info: McpAuthInfo,
	called: readonly string[],
	writes: (name: string) => Promise<boolean>,
): Promise<Response | undefined> {
	if (canWrite(auth, info)) return undefined;
	for (const name of called)
		if (await writes(name))
			return insufficient(
				auth,
				[auth.read, auth.write],
				`${name} needs the scope ${auth.write}`,
			);
	return undefined;
}
