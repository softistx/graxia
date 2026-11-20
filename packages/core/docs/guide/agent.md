# Ready for agents: `@graxia/core/agent`

A schema an AI agent can read and act on needs four things: what each field requires, the limits of
each input, the errors each field may return, and a `fix` on every error. `@graxia/core/agent` adds
the first three as three descriptive directives, prints the schema an agent may see, and lints the
descriptions. It is a separate subpath: the root import stays lean.

```ts
import {
	agentTypeDefs,
	lintDescriptions,
	printSchemaFor,
	visibleSchema,
} from '@graxia/core/agent';
```

## The directives

```ts
import { createSchema } from '@graxia/core';
import { agentTypeDefs } from '@graxia/core/agent';

const schema = createSchema()({
	typeDefs: [
		agentTypeDefs,
		`
		"The API."
		type Query {
			"The books the caller may read."
			books(
				"Words the title contains."
				search: String @constraint(minLength: 2, maxLength: 80)
				"How many books to return."
				first: Int = 10 @constraint(min: 1, max: 100)
			): [Book!]! @errors(codes: ["BAD_USER_INPUT"])
			"Every member of the library."
			members: [Member!]! @needs(permission: "members:read")
		}
		"A book on a shelf."
		type Book { "The book identifier." id: ID! }
		"A person registered with the library."
		type Member @needs(permission: "members:read") { "The member identifier." id: ID! }
	`,
	],
	resolvers: {},
});
```

| directive                                                                                                                  | on                       | meaning                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@needs(permission: String)` or `@needs(anyOf: [String!])`, repeatable                                                     | field, object, interface | The permission a caller needs, or any one of a list. Repeated: every `@needs` must hold (AND).                                                                         |
| `@constraint(minLength, maxLength, min, max, exclusiveMin, exclusiveMax, multipleOf, minItems, maxItems, pattern, format)` | argument, input field    | The limits of a value, for clients and agents (JSON Schema names: `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minItems`, `maxItems`). |
| `@errors(codes: [String!]!)`                                                                                               | field                    | The `extensions.code` values the field may return.                                                                                                                     |

Give `@needs` exactly one of `permission` and `anyOf`. A use with both or neither is invalid: the
field stays hidden from every caller (it fails closed) and `lintDescriptions` reports `invalid-needs`.
`@needs(permission: "a") @needs(anyOf: ["b", "c"])` means `a` AND (`b` OR `c`).

They are **descriptive**: graxia does not enforce them. Enforce `@needs` in your resolvers or a
plugin, and validate inputs where you accept them. Enforcement is on the roadmap.

For a schema built in code, pass `agentDirectives` to `new GraphQLSchema({ directives })`, and put the
same information in `extensions` with `agentExtensions`:

```ts
import { GraphQLString } from 'graphql';
import { agentExtensions } from '@graxia/core/agent';

const field = {
	type: GraphQLString,
	extensions: agentExtensions({
		needs: ['books:write', { anyOf: ['books:admin', 'books:owner'] }],
		errors: 'CONFLICT', // a code, or an array of codes
	}),
};
```

## Reading them

```ts
import { constraintOf, errorsOf, needsOf } from '@graxia/core/agent';

needsOf(fieldOrType); // [['members:read']]: AND of any-of groups; [['a'], ['b', 'c']] is a AND (b OR c)
constraintOf(argOrInputField); // { minLength: 2, maxLength: 80 } or undefined
errorsOf(field); // ['BAD_USER_INPUT']
```

Each reads the directives (including those on `extend type`) and `extensions.graxia`.

## `printSchemaFor(schema, { can })` and `visibleSchema`

The SDL one caller may see. `visibleSchema(schema, { can })` returns the same view as a
`GraphQLSchema` (no resolvers; the agent directives kept), to validate or introspect against. `can(permission)` says whether they hold a permission; absent, everything
is visible.

```ts
const sdl = printSchemaFor(schema, {
	can: (permission) => principal.permissions.has(permission),
});
```

`can` is typed `Can`, exported from `@graxia/core/agent`: `(permission: string) => boolean`.

- A field or type whose `@needs` fails is removed. A type left without fields is removed, and so is
  every field that returns it, until nothing changes. A union loses removed members and goes when none is left.
- Types no kept root type reaches are dropped (also with no `can`). An object that no longer has the
  fields of an interface stops declaring it.
- An object that is kept still implements its interfaces: an interface field that a kept
  implementer lacks is hidden too, and an interface left without fields is removed.
- The view always has a valid `Query`. When no query field is visible, `Query` keeps one placeholder
  field, `_empty: Boolean`, described as "Placeholder: no query field is visible to this caller."
  Nothing visible prints that minimal schema, never `""`; `buildSchema` accepts it.
- It keeps descriptions, `@deprecated`, `@specifiedBy`, `@oneOf` and the applied `@needs`,
  `@constraint` and `@errors`, declares the agent directives it uses, and leaves out `@defer`,
  `@stream`, introspection and built-in scalars. `buildSchema(sdl)` accepts the result. Types come in
  the schema's own order.
- It walks the whole schema: call it once per kind of principal and keep the text, not once per request.

## `lintDescriptions(schema, options)`

```ts
import { expect, test } from 'bun:test';
import { lintDescriptions } from '@graxia/core/agent';
import { schema } from './schema';

const knownErrorCodes = ['BAD_USER_INPUT', 'CONFLICT', 'NOT_FOUND'];

test('the schema describes itself', () => {
	expect(lintDescriptions(schema, { knownErrorCodes })).toEqual([]);
});
```

It returns `{ coordinate, rule, message, fix }[]` sorted by coordinate (`Type`, `Type.field`,
`Type.field(arg:)`, `Enum.VALUE`, `Input.field`):

| rule                      | when                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `missing-description`     | a type, field, argument, enum value or input field has none (`require` turns a kind off) |
| `short-description`       | under `minLength` characters (12 by default)                                             |
| `name-only-description`   | it only says the name again (`The id.` on `id`)                                          |
| `unknown-error-code`      | an `@errors` code is not in `knownErrorCodes`                                            |
| `invalid-needs`           | a `@needs` gives both `permission` and `anyOf`, or neither                               |
| `mutation-without-errors` | a mutation has no `@errors`                                                              |

The last two run only when `knownErrorCodes` is set. A field that implements a described interface field inherits its description. Introspection types,
built-in scalars and directive definitions are skipped.

## The `fix` contract

Every error graxia emits carries `extensions.fix`, a short sentence saying what the client changes,
the same in development and in production. The full contract, which errors are stamped and which are
never touched, is in [Errors](./errors.md#the-fix-contract). Errors you create with `exposedError`
carry the `fix` you give them; write one, so an agent can recover.
