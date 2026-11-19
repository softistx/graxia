import { insufficient } from './bearer';
import type { McpAuthInfo, ResolvedAuth } from './types';

/** Whether the token may call the tools that write (`graphql_mutate`, a mutation's typed tool). */
export const canWrite = (auth: ResolvedAuth, info: McpAuthInfo): boolean =>
	info.scopes.includes(auth.write);

/** The names of the tool calls in a JSON-RPC body (a message or a batch). */
function calledTools(body: unknown): string[] {
	const messages = Array.isArray(body) ? body : [body];
	return messages.flatMap((message) => {
		if (typeof message !== 'object' || message === null) return [];
		const { method, params } = message as {
			method?: unknown;
			params?: { name?: unknown };
		};
		return method === 'tools/call' && typeof params?.name === 'string'
			? [params.name]
			: [];
	});
}

/**
 * Step-up: a read-only token that calls one of `writeTools` (`graphql_mutate`
 * or a mutation's typed tool, from a stale tool list) gets the 403
 * `insufficient_scope` naming `read write`, so a client can re-authorize.
 * Only when the server has mutations on: otherwise no scope would help, and
 * the call gets the SDK's tool-not-found. Reads the body copy, so call it on
 * the admitted request.
 */
export async function writeStepUp(
	request: Request,
	auth: ResolvedAuth,
	info: McpAuthInfo,
	writeTools: ReadonlySet<string>,
): Promise<Response | undefined> {
	if (canWrite(auth, info)) return undefined;
	let body: unknown;
	try {
		body = JSON.parse(await request.clone().text());
	} catch {
		return undefined;
	}
	const called = calledTools(body).find((name) => writeTools.has(name));
	if (called === undefined) return undefined;
	return insufficient(
		auth,
		[auth.read, auth.write],
		`${called} needs the scope ${auth.write}`,
	);
}
