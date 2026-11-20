import { type Constraint, constraintOf } from '@softistx/graxia/agent';
import {
	type DocumentNode,
	type FragmentDefinitionNode,
	type GraphQLArgument,
	type GraphQLInputField,
	type GraphQLSchema,
	getNamedType,
	isInputObjectType,
	Kind,
	type OperationDefinitionNode,
	TypeInfo,
	visit,
	visitWithTypeInfo,
} from 'graphql';

/** What the places a variable is used at say about it. */
export interface VariableUsage {
	/** The `@constraint` of each argument or input field the variable feeds. */
	constraints: Constraint[];
	/** The description of the first such argument or input field that has one. */
	description?: string;
}

/** The operation and the fragments it reaches, through spreads of spreads. */
function reachable(
	document: DocumentNode,
	operation: OperationDefinitionNode,
): DocumentNode {
	const fragments = new Map<string, FragmentDefinitionNode>();
	for (const definition of document.definitions)
		if (definition.kind === Kind.FRAGMENT_DEFINITION)
			fragments.set(definition.name.value, definition);
	const reached = new Set<FragmentDefinitionNode>();
	const follow = (node: OperationDefinitionNode | FragmentDefinitionNode) =>
		visit(node, {
			FragmentSpread(spread) {
				const fragment = fragments.get(spread.name.value);
				if (!fragment || reached.has(fragment)) return;
				reached.add(fragment);
				follow(fragment);
			},
		});
	follow(operation);
	return { kind: Kind.DOCUMENT, definitions: [operation, ...reached] };
}

/**
 * Where each variable of `operation` is used as a whole argument or input
 * field value (in the operation and the fragments it reaches): the
 * constraints and the description of those arguments and fields.
 */
export function variableUsages(
	schema: GraphQLSchema,
	document: DocumentNode,
	operation: OperationDefinitionNode,
): Map<string, VariableUsage> {
	const usages = new Map<string, VariableUsage>();
	const note = (name: string, target: GraphQLArgument | GraphQLInputField) => {
		const usage = usages.get(name) ?? { constraints: [] };
		const constraint = constraintOf(target);
		if (constraint) usage.constraints.push(constraint);
		if (usage.description === undefined && target.description)
			usage.description = target.description;
		usages.set(name, usage);
	};
	const typeInfo = new TypeInfo(schema);
	visit(
		reachable(document, operation),
		visitWithTypeInfo(typeInfo, {
			Variable(node, _key, parent) {
				if (!parent || Array.isArray(parent)) return;
				const holder = parent as { kind: string; name?: { value: string } };
				if (holder.kind === Kind.ARGUMENT) {
					const argument = typeInfo.getArgument();
					if (argument) note(node.name.value, argument);
				} else if (holder.kind === Kind.OBJECT_FIELD) {
					const object = typeInfo.getParentInputType();
					const named = object ? getNamedType(object) : undefined;
					const field = isInputObjectType(named)
						? named.getFields()[holder.name?.value ?? '']
						: undefined;
					if (field) note(node.name.value, field);
				}
			},
		}),
	);
	return usages;
}
