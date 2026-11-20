import {
	type DocumentNode,
	type FieldNode,
	type FragmentDefinitionNode,
	type GraphQLCompositeType,
	type GraphQLOutputType,
	type GraphQLSchema,
	isAbstractType,
	isCompositeType,
	isEnumType,
	isListType,
	isNonNullType,
	isObjectType,
	isUnionType,
	Kind,
	type OperationDefinitionNode,
	type SelectionSetNode,
} from 'graphql';
import { enumSchema, nullable, SCALARS } from './input-type';
import type { JsonSchema } from './types';

/** The `errors` of a result: GraphQL errors, each with graxia's `extensions.code` and `extensions.fix`. */
const ERRORS: JsonSchema = {
	type: 'array',
	items: {
		type: 'object',
		properties: {
			message: { type: 'string' },
			path: { type: 'array', items: { type: ['string', 'integer'] } },
			extensions: {
				type: 'object',
				properties: { code: { type: 'string' }, fix: { type: 'string' } },
			},
		},
		required: ['message'],
	},
};

interface Walk {
	schema: GraphQLSchema;
	fragments: ReadonlyMap<string, FragmentDefinitionNode>;
}

/** A selection set on an object, and whether it applies to every such object (`sure`). */
interface Origin {
	set: SelectionSetNode;
	sure: boolean;
}

/** A field node under a response key; `sure` when it is selected on every object that has the key's parent. */
interface Selected {
	node: FieldNode;
	sure: boolean;
}

/** One response key: the fields selected under it, grouped by their type, and the origins that always select it. */
interface Slot {
	sureIn: Set<Origin>;
	typename: boolean;
	byType: Map<string, { type: GraphQLOutputType; nodes: Selected[] }>;
}

const conditional = (node: {
	directives?: readonly { name: { value: string } }[] | undefined;
}) =>
	(node.directives ?? []).some(
		(d) => d.name.value === 'skip' || d.name.value === 'include',
	);

/** Whether a fragment on `condition` applies to every object a field of type `parent` returns. */
function covers(
	schema: GraphQLSchema,
	parent: GraphQLCompositeType,
	condition: GraphQLCompositeType,
): boolean {
	if (condition === parent || isObjectType(parent)) return true;
	return schema
		.getPossibleTypes(parent)
		.every((t) =>
			isAbstractType(condition)
				? schema.isSubType(condition, t)
				: t === condition,
		);
}

function collect(
	walk: Walk,
	parent: GraphQLCompositeType,
	set: SelectionSetNode,
	always: boolean,
	origin: Origin,
	slots: Map<string, Slot>,
): void {
	for (const selection of set.selections) {
		const sure = always && !conditional(selection);
		if (selection.kind === Kind.FIELD) {
			const key = selection.alias?.value ?? selection.name.value;
			const slot = slots.get(key) ?? {
				sureIn: new Set(),
				typename: false,
				byType: new Map(),
			};
			slots.set(key, slot);
			if (sure) slot.sureIn.add(origin);
			const field = isUnionType(parent)
				? undefined
				: parent.getFields()[selection.name.value];
			if (!field) {
				slot.typename = true;
				continue;
			}
			const group = slot.byType.get(String(field.type)) ?? {
				type: field.type,
				nodes: [],
			};
			group.nodes.push({ node: selection, sure: sure && origin.sure });
			slot.byType.set(String(field.type), group);
			continue;
		}
		const fragment =
			selection.kind === Kind.FRAGMENT_SPREAD
				? walk.fragments.get(selection.name.value)
				: selection;
		if (!fragment) continue;
		const named = fragment.typeCondition
			? walk.schema.getType(fragment.typeCondition.name.value)
			: parent;
		if (!isCompositeType(named)) continue;
		collect(
			walk,
			named,
			fragment.selectionSet,
			sure && covers(walk.schema, parent, named),
			origin,
			slots,
		);
	}
}

/**
 * The object the selection sets `origins` produce on `parent`, fragments
 * merged. A key is required when an origin that applies to every object
 * always selects it, or when every origin does: several field nodes can
 * share one response key, and an object may come from only some of them.
 */
function objectOf(
	walk: Walk,
	parent: GraphQLCompositeType,
	origins: readonly Origin[],
): JsonSchema {
	const slots = new Map<string, Slot>();
	for (const origin of origins)
		collect(walk, parent, origin.set, true, origin, slots);
	const properties: Record<string, JsonSchema> = {};
	for (const [key, slot] of slots) {
		const shapes = [...slot.byType.values()].map((group) =>
			typeOf(walk, group.type, group.nodes),
		);
		if (slot.typename) shapes.unshift({ type: 'string' });
		properties[key] =
			shapes.length === 1 ? (shapes[0] as JsonSchema) : { anyOf: shapes };
	}
	const required = [...slots]
		.filter(
			([, slot]) =>
				slot.sureIn.size === origins.length ||
				[...slot.sureIn].some((origin) => origin.sure),
		)
		.map(([key]) => key);
	return {
		type: 'object',
		properties,
		...(required.length > 0 ? { required } : {}),
	};
}

function shapeOf(
	walk: Walk,
	type: GraphQLOutputType,
	nodes: readonly Selected[],
): JsonSchema {
	if (isNonNullType(type)) return shapeOf(walk, type.ofType, nodes);
	if (isListType(type))
		return { type: 'array', items: typeOf(walk, type.ofType, nodes) };
	if (isCompositeType(type))
		return objectOf(
			walk,
			type,
			nodes.flatMap(({ node, sure }) =>
				node.selectionSet ? [{ set: node.selectionSet, sure }] : [],
			),
		);
	if (isEnumType(type)) return enumSchema(type);
	const builtIn = SCALARS[type.name];
	return builtIn ? { type: builtIn } : {};
}

const typeOf = (
	walk: Walk,
	type: GraphQLOutputType,
	nodes: readonly Selected[],
): JsonSchema =>
	isNonNullType(type)
		? shapeOf(walk, type.ofType, nodes)
		: nullable(shapeOf(walk, type, nodes));

/**
 * The JSON Schema of a tool's result, `{ data, errors }`, from the selection
 * set of `operation`: nullable fields accept `null`, fragments are merged,
 * and on an interface or union the fields of a narrower fragment are
 * optional properties (no `anyOf` per concrete type). A field under `@skip`
 * or `@include` is optional. The document must be valid against `schema`.
 */
export function outputSchemaOf(
	schema: GraphQLSchema,
	document: DocumentNode,
	operation: OperationDefinitionNode,
): JsonSchema {
	const fragments = new Map<string, FragmentDefinitionNode>();
	for (const definition of document.definitions)
		if (definition.kind === Kind.FRAGMENT_DEFINITION)
			fragments.set(definition.name.value, definition);
	const root = schema.getRootType(operation.operation);
	const data = root
		? nullable(
				objectOf({ schema, fragments }, root, [
					{ set: operation.selectionSet, sure: true },
				]),
			)
		: {};
	return { type: 'object', properties: { data, errors: ERRORS } };
}
