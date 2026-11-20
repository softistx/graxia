import type { McpServer } from '@modelcontextprotocol/server';
import { advertised } from '../operations/register';
import { refused } from './result';

/** The fix of a generic tool called on a strict server: the typed tools the caller has, or that there is none. */
export const strictFix = (typed: readonly string[]): string =>
	typed.length > 0
		? `This server runs trusted documents only: use the typed tools (${typed.join(', ')}).`
		: 'This server runs trusted documents only and offers you no typed tool: no operation can be run here.';

/**
 * graxia runs trusted documents in strict mode: a document an agent writes
 * must not run, though `graxia.execute` (in process) would run it. So
 * `graphql_query` and `graphql_mutate` only answer core's
 * `PERSISTED_QUERY_ONLY` refusal. Register them for a request that calls
 * tools and does not list them: they are never advertised.
 */
export function registerStrictRefusals(
	server: McpServer,
	typed: readonly string[],
): void {
	for (const name of ['graphql_query', 'graphql_mutate'])
		server.registerTool(
			name,
			{ inputSchema: advertised({ type: 'object' }) },
			async () =>
				refused(
					'Only persisted documents are allowed.',
					'PERSISTED_QUERY_ONLY',
					strictFix(typed),
				),
		);
}
