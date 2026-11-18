import { type DocumentNode, Kind, type OperationDefinitionNode } from 'graphql';
import { createWalker, fragmentMap, type Tracked } from '../limits/walk';

const memo = new WeakMap<
	OperationDefinitionNode,
	Map<string, Map<string, Tracked>>
>();

/** The operation `execute` will run: the one named, or the only one. */
export function selectedOperation(
	document: DocumentNode,
	name: string | null | undefined,
): OperationDefinitionNode | undefined {
	const operations = document.definitions.filter(
		(d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
	);
	if (name) return operations.find((o) => o.name?.value === name);
	return operations.length === 1 ? operations[0] : undefined;
}

/**
 * How `fields` are selected in `operation`, fragments expanded: for each field
 * (in the order the document first selects it) its selections and distinct paths.
 * Kept per operation node, so a cached document is walked once.
 */
export function countFields(
	document: DocumentNode,
	operation: OperationDefinitionNode,
	fields: ReadonlySet<string>,
): Map<string, Tracked> {
	const id = [...fields].join('\0');
	const known = memo.get(operation)?.get(id);
	if (known) return known;
	const walker = createWalker(fragmentMap(document), fields);
	const { tracked } = walker.operation(operation);
	const byFields = memo.get(operation) ?? new Map();
	byFields.set(id, tracked);
	memo.set(operation, byFields);
	return tracked;
}
