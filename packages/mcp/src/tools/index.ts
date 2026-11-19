import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type ExecuteContext, runOperation } from './execute';
import { textResult } from './result';
import { overview, SEARCH_LIMIT, searchSdl, typesSdl } from './schema';

const operationInput = z.object({
	query: z.string().describe('The GraphQL document (one operation).'),
	variables: z
		.record(z.string(), z.unknown())
		.optional()
		.describe('The operation variables, as a JSON object.'),
	operationName: z
		.string()
		.optional()
		.describe('Which operation to run when the document has several.'),
});

const schemaInput = z.object({
	search: z
		.string()
		.optional()
		.describe('Words to find in type and field names and descriptions.'),
	types: z
		.array(z.string())
		.max(SEARCH_LIMIT)
		.optional()
		.describe('Names of the types whose SDL to return.'),
});

/** What the tools need for one request. */
export interface ToolsInput {
	context: ExecuteContext;
	mutations: boolean;
}

/** Registers the generic tools on a per-request server. */
export function registerTools(server: McpServer, input: ToolsInput): void {
	const { context, mutations } = input;
	server.registerTool(
		'graphql_schema',
		{
			title: 'GraphQL schema',
			description:
				'Describe the GraphQL API you may use. CALL THIS FIRST. With no input: the available operations and the type names. With { types: ["Name"] }: the SDL of those types (descriptions, @needs permissions, @constraint limits and @errors codes included). With { search: "word" }: the types whose names or descriptions match. A name not shown here is not available to you.',
			inputSchema: schemaInput,
			annotations: { readOnlyHint: true },
		},
		(args) =>
			guarded(context, async () => {
				const view = await context.view();
				if (args.types && args.types.length > 0)
					return typesSdl(view, args.types, mutations);
				if (args.search !== undefined)
					return searchSdl(view, args.search, mutations);
				return overview(view, mutations);
			}),
	);
	server.registerTool(
		'graphql_query',
		{
			title: 'GraphQL query',
			description:
				'Run a GraphQL query (read only). Call graphql_schema first to learn the fields. Returns { data, errors }; every error has extensions.code and extensions.fix: read the fix. Mutations, subscriptions and introspection (__schema, __type) are refused: use graphql_schema to read the schema. @defer and @stream are not available.',
			inputSchema: operationInput,
			annotations: { readOnlyHint: true },
		},
		(args) => guarded(context, () => runOperation('query', args, context)),
	);
	if (!mutations) return;
	server.registerTool(
		'graphql_mutate',
		{
			title: 'GraphQL mutation',
			description:
				'Run a GraphQL mutation (it changes data). Call graphql_schema first to learn the mutations, their @needs permissions and @errors codes. Returns { data, errors }; every error has extensions.code and extensions.fix: read the fix. Queries are refused here: use graphql_query.',
			inputSchema: operationInput,
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		(args) => guarded(context, () => runOperation('mutation', args, context)),
	);
}

/** An unexpected failure goes to `onError` with its cause; the agent gets a generic message, nothing about the server leaks. */
async function guarded(
	context: ExecuteContext,
	run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
	try {
		return await run();
	} catch (error) {
		context.onError(error);
		return textResult(
			'The server failed to run the operation. Fix: retry later.',
			true,
		);
	}
}
