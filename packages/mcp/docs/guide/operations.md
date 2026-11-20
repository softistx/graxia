# Persisted operations as typed tools

Give `createMcp` the operations your clients already persist and each one becomes an MCP tool: a
name, a description, a JSON Schema for its arguments (from the operation's variables) and one for
its result (from its selection set). An agent calls `book_by_id({ id: "1" })` instead of writing
GraphQL, and runs only operations you have reviewed.

```ts
import { createGraxia } from '@graxia/core';
import { createMcp } from '@graxia/mcp';
import manifest from './persisted-documents.json';

const graxia = createGraxia({ schema, trustedDocuments: { manifest } });
const mcp = createMcp(graxia, {
	name: 'library',
	operations: { documents: manifest },
});
```

That is all: no handler to write. With this operation in the manifest

```graphql
"""
Find a book by its id.
"""
query BookById(
	"""
	The book id.
	"""
	$id: ID!
) {
	book(id: $id) {
		id
		title
	}
}
```

`tools/list` holds

```json
{
	"name": "book_by_id",
	"title": "BookById",
	"description": "Find a book by its id.",
	"inputSchema": {
		"type": "object",
		"properties": { "id": { "type": "string", "description": "The book id." } },
		"required": ["id"],
		"additionalProperties": false
	},
	"annotations": { "readOnlyHint": true }
}
```

plus an `outputSchema`, and `tools/call` with `{ "id": "1" }` answers
`{ "data": { "book": { "id": "1", "title": "Dune" } } }`.

## The manifest

`operations.documents` is core's `TrustedManifest`, in the three formats `trustedDocuments.manifest`
takes: an object of id to source (GraphQL Code Generator's `persisted-documents.json`, Relay's
persisted queries file), an Apollo persisted query manifest
(`{ format: 'apollo-persisted-query-manifest', version: 1, operations: [{ id, body }] }`), or a
`Map`. It is usually the same object you give `trustedDocuments`, but it does not have to be.
Your client toolchain writes it: core's
[trusted documents guide](https://github.com/softistx/graxia/blob/develop/packages/core/docs/guide/trusted-documents.md)
shows how for each one. A real client manifest holds every operation of the application, so the
first boot lists the ones without a description: narrow it with `include`, or fill `descriptions`.

- One tool per **named** operation. The tool name is the operation name in snake case
  (`BookById` → `book_by_id`, `HTTPStatus` → `http_status`); the title is the operation name.
- **Queries** are tools. **Mutations** are tools only with `mutations: true`.
  **Subscriptions** are skipped: MCP tools answer once.
- `include` picks the operations to offer. An operation it leaves out is not validated and needs no
  description; every document must still parse and name its operations:

```ts
operations: {
	documents: manifest,
	include: ({ name, kind, id }) => kind === 'query' && !name.startsWith('Admin'),
},
```

Everything is checked once, in `createMcp`, against the full schema. It throws one
`GraxiaConfigError` listing **every** problem with its fix, so a manifest is corrected in one pass
(see [troubleshooting](../troubleshooting.md)): an anonymous operation, two operations giving one
tool name, a name starting with `graphql_` or longer than 128 characters, a document that does not
parse or validate, `@defer` or `@stream`, introspection, a missing description, and a
`descriptions` key that names no operation.

## Descriptions

A description is **required**: an agent picks a tool by it. Write it where the operation lives,
with the executable-descriptions syntax graphql 17 parses, or give it by operation name:

```ts
operations: {
	documents: manifest,
	descriptions: { BookById: 'Find a book by its id.' }, // wins over the document's own
},
```

A variable's description becomes the `description` of its property. A variable without one takes
the description of the argument or input field it feeds.

> Your toolchain must keep the descriptions in the manifest. GraphQL Code Generator's client preset
> keeps them when the project's `graphql` is 16.12 or later (flattened to one line); before 16.12
> the sources do not parse with a description, so use `descriptions`. Open
> `persisted-documents.json` to check: the boot error names each operation that lacks one.

## The input schema

JSON Schema 2020-12, `type: "object"`, `additionalProperties: false`, one property per variable.

| GraphQL                        | JSON Schema                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `Int`                          | `{ "type": "integer" }`                                                          |
| `Float`                        | `{ "type": "number" }`                                                           |
| `String`, `ID`                 | `{ "type": "string" }`                                                           |
| `Boolean`                      | `{ "type": "boolean" }`                                                          |
| an enum                        | `{ "type": "string", "enum": [...] }`, described values listed in `description`  |
| a list                         | `{ "type": "array", "items": ... }`                                              |
| an input object                | `{ "$ref": "#/$defs/Name" }`, the object under `$defs` (so recursive types work) |
| a `@oneOf` input object        | `oneOf`, one branch per field                                                    |
| a custom scalar                | `{}` with the scalar's description (any JSON value; no `format` is guessed)      |
| nullable (`String`)            | `"type": ["string", "null"]`; for an input object `anyOf` with `null`            |
| non-null without a default     | listed in `required`                                                             |
| a default (`$first: Int = 10`) | `"default": 10`                                                                  |
| a deprecated input field       | `"deprecated": true`                                                             |

### `@constraint`

`@constraint` (from `@graxia/core/agent`) becomes `minLength`, `maxLength`, `minimum`, `maximum`,
`exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `pattern`, `format`, and on a list `minItems`
and `maxItems` (the other limits then apply to the items). It is read:

- on **input fields**, inside `$defs`;
- for a **variable**, on the arguments and input fields the variable is used at. A variable used at
  several places gets the tightest bound of each kind; `pattern`, `format` and `multipleOf` are
  kept when the usages agree and left out when they differ.

The schema guides the agent; it is not the check. An argument the schema does not have is refused
(`MCP_UNKNOWN_ARGUMENT`, with the accepted names). The others go to graxia as variables, unchanged,
and graxia's own coercion and your resolvers decide: a wrong argument answers with a GraphQL error
(`Variable "$id" has invalid value: …`, code `BAD_USER_INPUT`) whose fix is
`Correct the arguments: see the tool's input schema.`

## The output schema

```json
{
	"type": "object",
	"properties": {
		"data": {
			"type": ["object", "null"],
			"properties": { "book": { "...": "..." } }
		},
		"errors": {
			"type": "array",
			"items": { "...": "message, path, extensions.code, extensions.fix" }
		}
	}
}
```

`data` follows the selection set, by response key (aliases included): a nullable field also accepts
`null`, lists are arrays, `__typename` is a string, named and inline fragments are merged.
On an interface or a union the fields of every fragment are merged into one object, and a field
selected only for some of the possible types (or under `@skip` / `@include`) is not required:
there is no branch per type. When several selections share one response key
(`... on Book { author { name } } ... on Mag { author { age } }`), a nested key is required only
if every one of them selects it, or one that always applies does. The same key with different
types in two fragments is an `anyOf`.
A custom scalar is `{}`.

The result keeps the shape of the generic tools ([results](./tools.md#results)):
`structuredContent` is `{ data?, errors? }`, `isError` is `true` when there is no `data`.

## Strict trusted documents

With `trustedDocuments` in `strict` mode (the default under `NODE_ENV=production`) the typed tools
are the only tools that run operations: `graphql_query` and `graphql_mutate` are not listed, and a
call answers `PERSISTED_QUERY_ONLY` with a fix naming the typed tools
([tools](./tools.md#trusted-documents)). The typed tools run through `graxia.execute`, in process,
which graxia trusts as it trusts your own server code: the operations are yours, read at boot; the
agent only chooses one and gives its variables. Limits, cost, masking, field rate limits and your
`context` still apply. A strict server without `operations` boots, with `graphql_schema` alone.

## Only the typed tools

```ts
createMcp(graxia, {
	name: 'library',
	operations: { documents: manifest },
	genericTools: false, // no graphql_query, no graphql_mutate
});
```

`graphql_schema` stays, and names the typed tools. `genericTools: false` without `operations`, or
with operations that give no tool, throws: there would be nothing to call. This is the tightest
surface: see [security](./security.md#typed-tools-only).

## Permissions and scopes

- **`can`**: a tool is listed for a caller only when its operation is valid against the schema that
  caller may see. A tool using a field behind a `@needs` they lack is not listed, and calling it
  answers `Tool <name> not found`, exactly like a tool that does not exist.
- **`auth`**: query tools need the read scope (`mcp:read`), mutation tools the write scope
  (`mcp:write`). A read-only token does not see the mutation tools, and calling one is the same 403
  step-up as `graphql_mutate` ([auth](./auth.md#scopes-and-step-up)), unless `can` hides the tool
  from that caller: then it is `Tool <name> not found`.
- Query tools carry `readOnlyHint: true`; mutation tools `readOnlyHint: false, destructiveHint: true`.

## Cost

Parsing, validation and both schemas are computed once, in `createMcp`. Per request only the
filter by the caller's view runs: once for all callers without `can`; with `can`, once per
`tools/list` and `tools/call` request (the view is built, so `can` runs, for those two only:
`initialize`, `ping` and notifications never call it). When `can` throws, nothing typed is listed
and a call answers `The server failed to run the operation. Fix: retry later.`
