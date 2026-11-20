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
import { MAX_TOOL_NAME, operationsError, problem } from './problems';
import type { McpOperationsOptions, OperationTool } from './types';

/** A named operation that becomes a tool. */
interface Wanted {
	name: string;
	node: OperationDefinitionNode;
}

interface Build {
	schema: GraphQLSchema;
	options: McpOperationsOptions;
	mutations: boolean;
	problems: string[];
	tools: Map<string, OperationTool>;
	/** Every operation name the documents hold, kept or not. */
	names: Set<string>;
}

/** A manifest entry whose source is a string that parses. */
interface Parsed {
	id: string;
	source: string;
	document: DocumentNode;
}

function parsed(entry: ManifestEntry, build: Build): Parsed | undefined {
	const { id, source } = entry;
	if (typeof source !== 'string' || source.trim() === '') {
		build.problems.push(problem.source(id));
		return undefined;
	}
	try {
		return { id, source, document: parse(source) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		build.problems.push(problem.parse(entry.id, message));
		return undefined;
	}
}

/** The operations of a document that become tools: named queries, mutations when on, kept by `include`. */
function wanted(document: DocumentNode, id: string, build: Build): Wanted[] {
	const kept: Wanted[] = [];
	for (const definition of document.definitions) {
		if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
		if (definition.name) build.names.add(definition.name.value);
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
		kept.push({ name, node: definition });
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

/** The description of an operation: the one of `descriptions`, else its own. */
function descriptionOf(wanted: Wanted, build: Build): string {
	const given = build.options.descriptions;
	const own =
		given && Object.hasOwn(given, wanted.name) ? given[wanted.name] : undefined;
	return String(own ?? wanted.node.description?.value ?? '').trim();
}

function addTool(wanted: Wanted, entry: Parsed, build: Build): void {
	const { name: title, node: operation } = wanted;
	const { id, document } = entry;
	const name = toolNameOf(title);
	const description = descriptionOf(wanted, build);
	const before = build.problems.length;
	if (description === '') build.problems.push(problem.description(title, id));
	if (name.startsWith(RESERVED_PREFIX))
		build.problems.push(problem.reserved(title, id, name));
	if (name.length > MAX_TOOL_NAME)
		build.problems.push(problem.tooLong(title, id, name));
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
		kind: operation.operation === 'mutation' ? 'mutation' : 'query',
		id,
		source: entry.source,
		document,
		inputSchema: inputSchemaOf(build.schema, document, operation),
		outputSchema: outputSchemaOf(build.schema, document, operation),
	});
}

function addDocument(raw: ManifestEntry, build: Build): void {
	const entry = parsed(raw, build);
	if (!entry) return;
	const { document } = entry;
	const operations = wanted(document, entry.id, build);
	if (operations.length === 0) return;
	const names = operations.map((o) => o.name);
	const directive = incremental(document);
	if (directive) {
		build.problems.push(
			problem.incremental(names.join(', '), entry.id, directive),
		);
		return;
	}
	const errors = validate(build.schema, document, specifiedRules);
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
	if (
		validate(build.schema, document, [NoSchemaIntrospectionCustomRule]).length >
		0
	) {
		build.problems.push(problem.introspection(names, entry.id));
		return;
	}
	for (const operation of operations) addTool(operation, entry, build);
}

/** A `descriptions` key that names no operation of the documents: a typo would silently do nothing. */
function checkDescriptions(build: Build): void {
	for (const key of Object.keys(build.options.descriptions ?? {})) {
		if (build.names.has(key)) continue;
		const close = [...build.names].find(
			(name) => name.toLowerCase() === key.toLowerCase(),
		);
		build.problems.push(problem.unusedDescription(key, close));
	}
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
		names: new Set(),
	};
	const entries = manifestEntries(options?.documents);
	if (!entries) throw operationsError([problem.manifest()]);
	for (const entry of entries) addDocument(entry, build);
	checkDescriptions(build);
	if (build.problems.length > 0) throw operationsError(build.problems);
	return [...build.tools.values()];
}
