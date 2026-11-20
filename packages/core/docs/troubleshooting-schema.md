# Troubleshooting: schema and resolvers

Schema directives, `createSchema` and resolver-map errors, headed by the message as it appears. The rest is in [Troubleshooting](./troubleshooting.md).

## Unknown directive "@needs" (or "@constraint", "@errors")

`createSchema` or `buildSchema` refuses the SDL because the agent directives are not declared. Add
`agentTypeDefs` from `@softistx/graxia/agent` to `typeDefs`, or pass `agentDirectives` to a schema
built in code.

```ts
createSchema()({ typeDefs: [agentTypeDefs, sdl], resolvers });
```

## Duplicate `@constraint` directive, or "There can be only one directive named "@constraint""

`agentTypeDefs` defines `@constraint`, and so does `graphql-constraint-directive` (or another library) if
you also use it: the schema then has two definitions of the same directive. graxia's `@constraint` only
describes limits for agents (it enforces nothing) and its arguments are a superset of the common ones
(`minLength`, `maxLength`, `min`, `max`, `exclusiveMin`, `exclusiveMax`, `multipleOf`, `minItems`, `maxItems`,
`pattern`, `format`). Keep one definition: leave `agentTypeDefs` out and declare the directive yourself with
the arguments you use, or remove the other library's definition. `printSchemaFor` declares only the agent
directives it prints, so it adds a second definition to a schema that already has one: print from a schema
that has the library's directive removed.

## `printSchemaFor` output does not build: "Unknown directive" or "Type X not found"

`buildSchema(printSchemaFor(schema))` fails when the schema uses a directive or type that the printer does not
write: only the agent directives (`@needs`, `@constraint`, `@errors`), `@deprecated`, `@specifiedBy` and `@oneOf`
are printed. Other applied directives (your own, `@cost`, `@listSize`) are left out, and a type reachable only
through them is dropped. Build the visible schema with `visibleSchema(schema, { can })`, which is always
valid, and validate against it. Pass a permission check that names every permission your `@needs` use: a
typo in a permission hides the field for every caller.

## `@needs` gives both `permission` and `anyOf`, or neither

`lintDescriptions` reports `invalid-needs`, and the field stays hidden from every caller (it fails closed).
Give exactly one: `@needs(permission: "books:write")` or `@needs(anyOf: ["books:write", "books:admin"])`.
Repeat `@needs` to require several (AND).

## Property ''createSchema<Ctx>: these resolvers expect another context (see expected)'' is missing

A type error on `resolvers`: the resolver map (typically graphql-codegen's `Resolvers<X>`) was built
for a context `X` that `createSchema<Ctx, …>()`'s `Ctx` does not provide. The message shows
`expected` (what the resolvers need) and `actual` (your `Ctx`). Point codegen's `contextType` at
the same `InferContext` type you pass to `createSchema`, regenerate, and see [Codegen](./guide/codegen.md).

## Invalid type definitions: …

The SDL passed to `createSchema` does not parse or build; graphql's message follows. Fix the SDL.

## Invalid schema: …

The SDL builds but the schema is not valid (for example a type with no fields); graphql's message
follows.

## Resolver Query.foo is defined more than once

Two resolver maps given to `createSchema` define the same field. Keep it in one map, or remove the
duplicate. (`Resolvers for X are defined more than once` is the same mistake for a non-object type.)

## Resolvers for X are defined but the schema has no type X

## Resolver Query.foo is defined but Query has no field foo

A resolver names a type or a field that the SDL does not declare, often a typo or a renamed field.
Add it to the SDL or remove the resolver. See [Schema](./guide/schema.md).

## Resolver Color.PURPLE is defined but enum Color has no value PURPLE

An enum resolver map names a value the SDL does not declare. Fix the name or add the value to the SDL.

## Resolver Pet.name is defined but a union has no fields; only __resolveType is allowed

A union has no fields: give it only `__resolveType`, and put field resolvers on its member types.

## Resolvers for X are defined more than once

Two resolver maps given to `createSchema` define a non-object type (a scalar or an enum, say) under
the same name. Keep one definition. For object types the message names the field instead
(`Resolver Query.foo is defined more than once`).

## Resolvers for X must be an object

The resolvers of an object, interface, union or enum type must be a plain object of fields (or
values). A function, string or array was given:

```ts
resolvers: {
	Query: {
		hello: () => 'hi';
	}
} // not `Query: () => 'hi'`
```

## Resolvers for X are defined but X is an input type

Input types have no resolvers. Remove the entry; defaults and validation belong in the SDL.

## Resolvers for X is a GraphQLScalarType but X is not a scalar

A `GraphQLScalarType` was given under the name of a type that the SDL declares as something else.
Declare `scalar X` in the SDL, or move the entry to the right name.

## Resolvers for scalar X must be a GraphQLScalarType

A scalar's entry is a graphql `GraphQLScalarType` (`new GraphQLScalarType({ name, parseValue, ... })`),
not a plain object or function.

## Resolvers for scalar X is a GraphQLScalarType named Y; the names must match

The `name` of the `GraphQLScalarType` differs from the key it sits under. Make them equal.

## Resolver X.y is not valid on an object type

## Resolver X.y is not valid on an interface type

A key starting with `__` that this kind of type does not take: `__isTypeOf` is for object types and
`__resolveType` for interfaces and unions. Move it to the right type, or rename the field (names
starting with `__` are reserved by GraphQL).

## Resolver X.y must be a function or { resolve, subscribe }

A field's resolver is a function, or an object with `resolve` and/or `subscribe` functions. Anything
else (a value, `null`) is refused. For a constant, write `() => value`.
