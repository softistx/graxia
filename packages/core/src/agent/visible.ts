import {
	type GraphQLNamedType,
	type GraphQLSchema,
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
}

type Can = (permission: string) => boolean;
type Composite = Extract<
	GraphQLNamedType,
	{ getFields(): unknown; getInterfaces(): unknown }
>;

const userTypes = (schema: GraphQLSchema): GraphQLNamedType[] =>
	Object.values(schema.getTypeMap()).filter((t) => !isIntrospectionType(t));

/**
 * Which types and fields a caller who passes `can` sees: what `@needs` hides
 * is removed; what that leaves empty is removed with every field that returns
 * it, until nothing changes; and what no kept root reaches is dropped.
 */
export function visibleView(schema: GraphQLSchema, can: Can): View {
	const allowed = (target: Parameters<typeof needsOf>[0]) =>
		needsOf(target).every(can);
	const removed = new Set<string>();
	const fields = new Map<string, Set<string>>();
	const composites = userTypes(schema).filter(
		(t): t is Composite => isObjectType(t) || isInterfaceType(t),
	);
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
	const unions = userTypes(schema).filter(isUnionType);
	for (let changed = true; changed; ) {
		changed = false;
		for (const type of composites) {
			const kept = fields.get(type.name);
			if (removed.has(type.name) || !kept) continue;
			for (const field of Object.values(type.getFields()))
				if (kept.has(field.name) && removed.has(getNamedType(field.type).name))
					kept.delete(field.name);
			if (kept.size === 0) {
				removed.add(type.name);
				changed = true;
			}
		}
		for (const union of unions)
			if (
				!removed.has(union.name) &&
				union.getTypes().every((member) => removed.has(member.name))
			) {
				removed.add(union.name);
				changed = true;
			}
	}
	const interfaces = new Map<string, string[]>();
	for (const type of composites) {
		if (removed.has(type.name)) continue;
		const own = fields.get(type.name) as Set<string>;
		interfaces.set(
			type.name,
			type
				.getInterfaces()
				.filter(
					(iface) =>
						!removed.has(iface.name) &&
						[...(fields.get(iface.name) ?? [])].every((f) => own.has(f)),
				)
				.map((iface) => iface.name),
		);
	}
	const members = new Map<string, string[]>(
		unions
			.filter((u) => !removed.has(u.name))
			.map((u) => [
				u.name,
				u
					.getTypes()
					.map((m) => m.name)
					.filter((n) => !removed.has(n)),
			]),
	);
	const roots: View['roots'] = {};
	for (const [key, root] of [
		['query', schema.getQueryType()],
		['mutation', schema.getMutationType()],
		['subscription', schema.getSubscriptionType()],
	] as const)
		if (root && !removed.has(root.name)) roots[key] = root.name;
	const types = reachable(schema, roots, {
		removed,
		fields,
		interfaces,
		members,
	});
	return {
		types,
		roots,
		fields: new Map([...fields].filter(([name]) => types.has(name))),
		members: new Map([...members].filter(([name]) => types.has(name))),
		interfaces: new Map([...interfaces].filter(([name]) => types.has(name))),
	};
}

/** The types reachable from the kept roots through kept fields, members and implementations. */
function reachable(
	schema: GraphQLSchema,
	roots: View['roots'],
	kept: {
		removed: Set<string>;
		fields: Map<string, Set<string>>;
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
