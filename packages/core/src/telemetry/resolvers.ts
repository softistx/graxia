import {
	defaultFieldResolver,
	type GraphQLSchema,
	isObjectType,
} from 'graphql';
import {
	ATTR,
	type Env,
	fail,
	type Live,
	recorded,
	SPAN,
	start,
} from './spans';

/** What a wrapped resolver reads for the operation it runs in. */
interface Bound {
	env: Env;
	/** The operation span: resolver spans hang under it. */
	parent: Live;
	trivial: boolean;
}

// Keyed by the operation's context value, so a schema shared by several instances (or one
// instance with tracing off) still works: a wrapper finds nothing and calls the resolver.
const bound = new WeakMap<object, Bound>();
const WRAPPED = Symbol.for('graxia.telemetry.wrapped');

/** @internal Makes the resolvers of the operation whose context value is `contextValue` traced. */
export function bindResolvers(
	contextValue: object,
	env: Env,
	parent: Live,
	trivial: boolean,
): void {
	bound.set(contextValue, { env, parent, trivial });
}

/** `user.posts.0.title`: the keys from the root down. */
interface PathLike {
	prev: PathLike | undefined;
	key: string | number;
}

function pathOf(path: PathLike | undefined): string {
	const keys: (string | number)[] = [];
	for (let at = path; at; at = at.prev) keys.push(at.key);
	return keys.reverse().join('.');
}

type Resolver = (source: any, args: any, ctx: any, info: any) => unknown;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
	typeof (value as PromiseLike<unknown> | null)?.then === 'function';

function traced(
	run: Resolver,
	{ env, parent }: Bound,
	args: [any, any, any, any],
): unknown {
	const info = args[3];
	const live = start(env, `${SPAN.resolve} ${info.fieldName}`, parent, {
		kind: 'internal',
		attributes: {
			[ATTR.fieldName]: info.fieldName,
			[ATTR.fieldPath]: pathOf(info.path),
			[ATTR.fieldType]: String(info.returnType),
			[ATTR.parentType]: info.parentType.name,
		},
	});
	const failed = (error: unknown) => {
		if (typeof error === 'object' && error !== null) recorded.add(error);
		fail(live, error);
		live.end();
	};
	try {
		const out = live.run(() => run(...args));
		if (!isThenable(out)) {
			live.end();
			return out;
		}
		return out.then(
			(value) => {
				live.end();
				return value;
			},
			(error) => {
				failed(error);
				throw error;
			},
		);
	} catch (error) {
		failed(error);
		throw error;
	}
}

function wrap(resolve: Resolver, isDefault: boolean): Resolver {
	const wrapper: Resolver = (source, args, ctx, info) => {
		const found =
			typeof ctx === 'object' && ctx !== null ? bound.get(ctx) : undefined;
		if (!found || (isDefault && !found.trivial))
			return resolve(source, args, ctx, info);
		return traced(resolve, found, [source, args, ctx, info]);
	};
	(wrapper as any)[WRAPPED] = true;
	return wrapper;
}

/**
 * Wraps the resolvers of `schema` once, in place (graphql 17 has no hook that
 * traces a field's own `resolve`). A resolver already wrapped (the schema is
 * shared with another instance) is left alone. With `trivial`, fields with
 * no resolver get a wrapped default one.
 */
export function wrapSchemaResolvers(
	schema: GraphQLSchema,
	trivial: boolean,
): void {
	for (const type of Object.values(schema.getTypeMap())) {
		if (!isObjectType(type) || type.name.startsWith('__')) continue;
		for (const field of Object.values(type.getFields())) {
			const resolve = field.resolve as Resolver | undefined;
			if (resolve) {
				if (!(resolve as any)[WRAPPED]) field.resolve = wrap(resolve, false);
			} else if (trivial) {
				field.resolve = wrap(defaultFieldResolver as Resolver, true);
			}
		}
	}
}
