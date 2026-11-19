import {
	type DocumentNode,
	type GraphQLSchema,
	Kind,
	NoSchemaIntrospectionCustomRule,
	type OperationDefinitionNode,
	parse,
	specifiedRules,
	validate,
	visit,
} from 'graphql';
import { type ManifestEntry, manifestEntries } from './documents';
import { inputSchemaOf } from './input-schema';
import { RESERVED_PREFIX, toolNameOf } from './naming';
import { outputSchemaOf } from './output-schema';
import { operationsError, problem } from './problems';
import type { McpOperationsOptions, OperationTool } from './types';

const RULES = [...specifiedRules, NoSchemaIntrospectionCustomRule];

interface Build {
	schema: GraphQLSchema;
	options: McpOperationsOptions;
	mutations: boolean;
	problems: string[];
	tools: Map<string, OperationTool>;
}

function parsed(entry: ManifestEntry, build: Build): DocumentNode | undefined {
	if (typeof entry.source !== 'string' || entry.source.trim() === '') {
		build.problems.push(problem.source(entry.id));
		return undefined;
	}
	try {
		return parse(entry.source);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		build.problems.push(problem.parse(entry.id, message));
		return undefined;
	}
}

/** The operations of a document that become tools: named queries, mutations when on, kept by `include`. */
function wanted(
	document: DocumentNode,
	id: string,
	build: Build,
): OperationDefinitionNode[] {
	const kept: OperationDefinitionNode[] = [];
	for (const definition of document.definitions) {
		if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
		const kind = definition.operation;
		if (kind === 'subscription') continue;
		if (kind === 'mutation' && !build.mutations) continue;
		if (!definition.name) {
			build.problems.push(problem.anonymous(id));
			continue;
		}
		const name = definition.name.value;
		if (build.options.include && !build.options.include({ name, kind, id }))
			continue;
		kept.push(definition);
	}
	return kept;
}

function incremental(document: DocumentNode): string | undefined {
	let found: string | undefined;
	visit(document, {
		Directive(node) {
			if (node.name.value === 'defer' || node.name.value === 'stream')
				found ??= node.name.value;
		},
	});
	return found;
}

function addTool(
	operation: OperationDefinitionNode,
	document: DocumentNode,
	entry: ManifestEntry,
	build: Build,
): void {
	const title = operation.name?.value as string;
	const { id } = entry;
	const name = toolNameOf(title);
	const description = (
		build.options.descriptions?.[title] ??
		operation.description?.value ??
		''
	).trim();
	const before = build.problems.length;
	if (description === '') build.problems.push(problem.description(title, id));
	if (name.startsWith(RESERVED_PREFIX))
		build.problems.push(problem.reserved(title, id, name));
	const taken = build.tools.get(name);
	if (taken)
		build.problems.push(
			problem.duplicate(
				name,
				{ name: taken.title, id: taken.id },
				{ name: title, id },
			),
		);
	if (build.problems.length > before) return;
	build.tools.set(name, {
		name,
		title,
		description,
		kind: operation.operation as 'query' | 'mutation',
		id,
		source: entry.source as string,
		document,
		inputSchema: inputSchemaOf(build.schema, document, operation),
		outputSchema: outputSchemaOf(build.schema, document, operation),
	});
}

function addDocument(entry: ManifestEntry, build: Build): void {
	const document = parsed(entry, build);
	if (!document) return;
	const operations = wanted(document, entry.id, build);
	if (operations.length === 0) return;
	const names = operations.map((o) => o.name?.value as string);
	const directive = incremental(document);
	if (directive) {
		build.problems.push(
			problem.incremental(names.join(', '), entry.id, directive),
		);
		return;
	}
	const errors = validate(build.schema, document, RULES);
	if (errors.length > 0) {
		build.problems.push(
			problem.invalid(
				names,
				entry.id,
				errors.map((e) => e.message),
			),
		);
		return;
	}
	for (const operation of operations)
		addTool(operation, document, entry, build);
}

/**
 * Builds the typed tools of `operations`, once: one per named query of each
 * document (and per mutation when `mutations` is on), with its input and
 * output schemas.
 * @throws {GraxiaConfigError} listing every problem, each with its fix.
 */
export function buildOperationTools(
	schema: GraphQLSchema,
	options: McpOperationsOptions,
	mutations: boolean,
): OperationTool[] {
	const build: Build = {
		schema,
		options,
		mutations,
		problems: [],
		tools: new Map(),
	};
	const entries = manifestEntries(options?.documents);
	if (!entries) throw operationsError([problem.manifest()]);
	for (const entry of entries) addDocument(entry, build);
	if (build.problems.length > 0) throw operationsError(build.problems);
	return [...build.tools.values()];
}
