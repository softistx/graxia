import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
	type ExecuteContext,
	type OperationInput,
	runOperation,
} from './execute';
import { textResult } from './result';
import { overview, searchSdl, typesSdl } from './schema';

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
		async (args) => {
			if (args.types && args.types.length > 0)
				return typesSdl(context.view, args.types);
			if (args.search !== undefined)
				return searchSdl(context.view, args.search);
			return overview(context.view, mutations);
		},
	);
	server.registerTool(
		'graphql_query',
		{
			title: 'GraphQL query',
			description:
				'Run a GraphQL query (read only). Call graphql_schema first to learn the fields. Returns { data, errors }; every error has extensions.code and extensions.fix: read the fix. Mutations and subscriptions are refused; @defer and @stream are not available.',
			inputSchema: operationInput,
			annotations: { readOnlyHint: true },
		},
		async (args) =>
			runOperation('query', args as OperationInput, context).catch(unexpected),
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
		async (args) =>
			runOperation('mutation', args as OperationInput, context).catch(
				unexpected,
			),
	);
}

/** An unexpected failure is reported without its cause: nothing about the server leaks. */
function unexpected() {
	return textResult(
		'The server failed to run the operation. Fix: retry later.',
		true,
	);
}
