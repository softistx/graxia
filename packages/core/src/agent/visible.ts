import {
	type GraphQLNamedType,
	type GraphQLSchema,
	type GraphQLUnionType,
	getNamedType,
	isInputObjectType,
	isInterfaceType,
	isIntrospectionType,
	isObjectType,
	isUnionType,
} from 'graphql';
import { needsOf } from './read';

/** What a caller sees of a schema: names only, nothing copied. */
export interface View {
	/** The types kept, by name. */
	types: ReadonlySet<string>;
	/** The fields kept of each object and interface type. */
	fields: ReadonlyMap<string, ReadonlySet<string>>;
	/** The members kept of each union. */
	members: ReadonlyMap<string, readonly string[]>;
	/** The interfaces each object and interface still declares it implements. */
	interfaces: ReadonlyMap<string, readonly string[]>;
	/** The root operation types kept. */
	roots: { query?: string; mutation?: string; subscription?: string };
	/** The Query type's name when no Query field is visible: it then holds one placeholder field. */
	placeholder?: string;
}

type Can = (permission: string) => boolean;
type Composite = Extract<
	GraphQLNamedType,
	{ getFields(): unknown; getInterfaces(): unknown }
>;
type Kept = {
	removed: Set<string>;
	fields: Map<string, Set<string>>;
};

const userTypes = (schema: GraphQLSchema): GraphQLNamedType[] =>
	Object.values(schema.getTypeMap()).filter((t) => !isIntrospectionType(t));

/** Whether `can` meets every requirement of `@needs` (each an any-of) on the target. */
const allowedBy =
	(can: Can) =>
	(target: Parameters<typeof needsOf>[0]): boolean =>
		needsOf(target).every((anyOf) => anyOf.some(can));

/** The types and fields `@needs` hides straight away. */
function hidden(
	composites: Composite[],
	allowed: (target: any) => boolean,
): Kept {
	const removed = new Set<string>();
	const fields = new Map<string, Set<string>>();
	for (const type of composites) {
		if (!allowed(type)) {
			removed.add(type.name);
			continue;
		}
		const kept = Object.values(type.getFields())
			.filter((field) => allowed(field))
			.map((field) => field.name);
		fields.set(type.name, new Set(kept));
	}
	return { removed, fields };
}

/** One pass: drops the fields that return a removed type, then removes the types left empty. */
function dropReturningRemoved(composites: Composite[], kept: Kept): boolean {
	let changed = false;
	for (const type of composites) {
		const own = kept.fields.get(type.name);
		if (kept.removed.has(type.name) || !own) continue;
		for (const field of Object.values(type.getFields()))
			if (
				own.has(field.name) &&
				kept.removed.has(getNamedType(field.type).name)
			)
				own.delete(field.name);
		if (own.size === 0) {
			kept.removed.add(type.name);
			changed = true;
		}
	}
	return changed;
}

/** One pass: an interface field a kept implementer lacks is hidden, so every implementer keeps `implements`. */
function dropUnimplemented(composites: Composite[], kept: Kept): boolean {
	let changed = false;
	for (const type of composites) {
		const own = kept.fields.get(type.name);
		if (kept.removed.has(type.name) || !own) continue;
		for (const iface of type.getInterfaces()) {
			const shared = kept.fields.get(iface.name);
			if (kept.removed.has(iface.name) || !shared) continue;
			for (const name of [...shared])
				if (!own.has(name)) {
					shared.delete(name);
					changed = true;
				}
		}
	}
	return changed;
}

/** One pass: a union whose members are all removed is removed. */
function dropEmptyUnions(unions: GraphQLUnionType[], kept: Kept): boolean {
	let changed = false;
	for (const union of unions)
		if (
			!kept.removed.has(union.name) &&
			union.getTypes().every((member) => kept.removed.has(member.name))
		) {
			kept.removed.add(union.name);
			changed = true;
		}
	return changed;
}

/** Removes what the hidden parts leave empty, to a fixed point. */
function prune(
	composites: Composite[],
	unions: GraphQLUnionType[],
	kept: Kept,
) {
	for (let changed = true; changed; ) {
		changed = dropReturningRemoved(composites, kept);
		changed = dropUnimplemented(composites, kept) || changed;
		changed = dropEmptyUnions(unions, kept) || changed;
		for (const [name, own] of kept.fields)
			if (!kept.removed.has(name) && own.size === 0) {
				kept.removed.add(name);
				changed = true;
			}
	}
}

/** The interfaces each kept object and interface still declares. */
function implementsOf(composites: Composite[], kept: Kept) {
	return new Map<string, string[]>(
		composites
			.filter((type) => !kept.removed.has(type.name))
			.map((type) => [
				type.name,
				type
					.getInterfaces()
					.filter((iface) => !kept.removed.has(iface.name))
					.map((iface) => iface.name),
			]),
	);
}

/** The kept members of each kept union. */
const membersOf = (unions: GraphQLUnionType[], kept: Kept) =>
	new Map<string, string[]>(
		unions
			.filter((union) => !kept.removed.has(union.name))
			.map((union) => [
				union.name,
				union
					.getTypes()
					.map((member) => member.name)
					.filter((name) => !kept.removed.has(name)),
			]),
	);

/** The root operation types that survive. */
function rootsOf(schema: GraphQLSchema, kept: Kept): View['roots'] {
	const roots: View['roots'] = {};
	for (const [key, root] of [
		['query', schema.getQueryType()],
		['mutation', schema.getMutationType()],
		['subscription', schema.getSubscriptionType()],
	] as const)
		if (root && !kept.removed.has(root.name)) roots[key] = root.name;
	return roots;
}

/**
 * Which types and fields a caller who passes `can` sees: what `@needs` hides
 * is removed; what that leaves empty is removed with every field that returns
 * it, and an interface field an implementer lacks is hidden, until nothing
 * changes; and what no kept root reaches is dropped. When no Query field is
 * left, the view keeps a Query holding a placeholder (`placeholder` names it).
 */
export function visibleView(schema: GraphQLSchema, can: Can): View {
	const composites = userTypes(schema).filter(
		(t): t is Composite => isObjectType(t) || isInterfaceType(t),
	);
	const unions = userTypes(schema).filter(isUnionType);
	const kept = hidden(composites, allowedBy(can));
	prune(composites, unions, kept);
	const interfaces = implementsOf(composites, kept);
	const members = membersOf(unions, kept);
	const roots = rootsOf(schema, kept);
	const types = reachable(schema, roots, { ...kept, interfaces, members });
	const view: View = {
		types,
		roots,
		fields: new Map([...kept.fields].filter(([name]) => types.has(name))),
		members: new Map([...members].filter(([name]) => types.has(name))),
		interfaces: new Map([...interfaces].filter(([name]) => types.has(name))),
	};
	if (!roots.query) {
		const name = schema.getQueryType()?.name ?? 'Query';
		view.placeholder = name;
		view.roots.query = name;
		types.add(name);
	}
	return view;
}

/** The types reachable from the kept roots through kept fields, members and implementations. */
function reachable(
	schema: GraphQLSchema,
	roots: View['roots'],
	kept: Kept & {
		interfaces: Map<string, string[]>;
		members: Map<string, string[]>;
	},
): Set<string> {
	const implementers = new Map<string, string[]>();
	for (const [name, ifaces] of kept.interfaces)
		for (const iface of ifaces)
			implementers.set(iface, [...(implementers.get(iface) ?? []), name]);
	const seen = new Set<string>();
	const queue = Object.values(roots);
	for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
		if (seen.has(name) || kept.removed.has(name)) continue;
		seen.add(name);
		const type = schema.getType(name);
		if (isObjectType(type) || isInterfaceType(type)) {
			for (const field of Object.values(type.getFields())) {
				if (!kept.fields.get(name)?.has(field.name)) continue;
				queue.push(getNamedType(field.type).name);
				for (const arg of field.args) queue.push(getNamedType(arg.type).name);
			}
			queue.push(...(kept.interfaces.get(name) ?? []));
			if (isInterfaceType(type)) queue.push(...(implementers.get(name) ?? []));
		} else if (isUnionType(type)) queue.push(...(kept.members.get(name) ?? []));
		else if (isInputObjectType(type))
			for (const field of Object.values(type.getFields()))
				queue.push(getNamedType(field.type).name);
	}
	return seen;
}
