# Schema

`createSchema` builds a plain graphql `GraphQLSchema` from SDL and resolvers. Any `GraphQLSchema`
works wherever graxia expects one; this is only a helper. It is curried so the context type is
explicit while `resolvers` infers.

The schema declares the `@defer` and `@stream` directives (see [`@defer` and `@stream`](./incremental.md)),
so graphql's plain `execute` refuses it with "The provided schema unexpectedly contains experimental directives (@defer or @stream). These directives may only be utilized if experimental execution features are explicitly enabled.": run it
through graxia, call `experimentalExecuteIncrementally`, or build it with
`createSchema()({ typeDefs, resolvers, incremental: false })` (no `@defer`, no incremental queries).

```ts
import { createSchema } from '@graxia/core';

type AppContext = { user: { name: string } };

export const schema = createSchema<AppContext>()({
	typeDefs: 'type Query { me: String }',
	resolvers: { Query: { me: (_parent, _args, ctx) => ctx.user.name } },
});
```

The result is typed `SchemaWithContext<AppContext>` (a `GraphQLSchema` carrying a type-only brand), so
`createGraxia` checks that the context it builds matches what the resolvers expect (see
[Context](./context.md#write-the-context-once)).

## Type definitions

`typeDefs` is an SDL string, a `DocumentNode`, or an array of both. `extend type` across entries works.

```ts
createSchema<AppContext>()({
	typeDefs: [
		userSdl,
		parse('type Query { ping: String }'),
		'extend type Query { me: String }',
	],
	resolvers: [
		userResolvers,
		{ Query: { ping: () => 'pong', me: (_, __, ctx) => ctx.user.name } },
	],
});
```

## Resolvers

`resolvers` is one map or an array of maps, merged per type and field. A field defined twice throws a
`GraxiaConfigError` naming `Type.field`. A resolver for a type or field the schema lacks throws too
(`Resolver Query.foo is defined but Query has no field foo`).

- Object and interface fields: a function, or `{ resolve, subscribe }`.
- Subscription fields: `{ subscribe, resolve }`. `subscribe` returns the event stream, `resolve` maps each event.
- Custom scalars: a `GraphQLScalarType` of the same name. The description written in the SDL wins; the scalar's is used when the SDL has none.
- Enums: `{ RED: 1, GREEN: 2 }` sets the internal values; a name the enum lacks throws.
- Interfaces and unions: `__resolveType`. Objects: `__isTypeOf`. Both are loosely typed (`any` parameters).

```ts
createSchema<AppContext>()({
	typeDefs:
		'enum Color { RED GREEN } type Query { c: Color } type Subscription { tick: Int }',
	resolvers: {
		Color: { RED: 1, GREEN: 2 },
		Query: { c: () => 1 },
		Subscription: {
			tick: {
				subscribe: async function* () {
					yield 1;
					yield 2;
				},
				resolve: (n) => (n as number) * 10,
			},
		},
	},
});
```

## Codegen resolvers

Pass the output type of graphql-codegen's `typescript-resolvers` as the second generic; `resolvers` is
then typed as that shape instead of the loose built-in `Resolvers<Ctx>`.

```ts
import type { Resolvers } from './generated/graphql';

createSchema<AppContext, Resolvers>()({ typeDefs, resolvers });
```

## Errors

Every failure is a `GraxiaConfigError` (`code: "GRAXIA_CONFIG"`): invalid SDL (the `GraphQLError` is its
`cause`), an invalid schema (for example no `Query` type), a duplicate or unknown resolver, a resolver
map given for a scalar that is not a `GraphQLScalarType`, or an enum value the enum lacks.
