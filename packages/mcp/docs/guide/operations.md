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

- One tool per **named** operation. The tool name is the operation name in snake case
  (`BookById` → `book_by_id`, `HTTPStatus` → `http_status`); the title is the operation name.
- **Queries** are tools. **Mutations** are tools only with `mutations: true`.
  **Subscriptions** are skipped: MCP tools answer once.
- `include` picks the operations to offer; the rest of the manifest is not read further:

```ts
operations: {
	documents: manifest,
	include: ({ name, kind, id }) => kind === 'query' && !name.startsWith('Admin'),
},
```

Everything is checked once, in `createMcp`, against the full schema. It throws one
`GraxiaConfigError` listing **every** problem with its fix, so a manifest is corrected in one pass
(see [troubleshooting](../troubleshooting.md)): an anonymous operation, two operations giving one
tool name, a name starting with `graphql_`, a document that does not parse or validate, `@defer` or
`@stream`, introspection, and a missing description.

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

> Your toolchain must keep the descriptions in the manifest. One built on graphql 16 does not parse
> them at all, and a printer may drop them. Open `persisted-documents.json`: if the
> `"""…"""` blocks are not in the sources, use `descriptions` (the boot error names each
> operation that lacks one).

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

The schema guides the agent; it is not the check. Arguments go to graxia as variables, unchanged,
and graxia's own coercion and your resolvers decide: a wrong argument answers with a GraphQL error
(`Variable "$id" has invalid value: …`) that carries `extensions.fix`.

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
there is no branch per type. The same key with different types in two fragments is an `anyOf`.
A custom scalar is `{}`.

The result keeps the shape of the generic tools ([results](./tools.md#results)):
`structuredContent` is `{ data?, errors? }`, `isError` is `true` when there is no `data`.

## Strict trusted documents

Typed tools work with `trustedDocuments` in `strict` mode, where `graphql_query` is refused: they
run through `graxia.execute`, in process, which graxia trusts as it trusts your own server code. The
operations are yours, read at boot; the agent only chooses one and gives its variables. Limits,
cost, masking, field rate limits and your `context` still apply.

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
  step-up as `graphql_mutate` ([auth](./auth.md)).
- Query tools carry `readOnlyHint: true`; mutation tools `readOnlyHint: false, destructiveHint: true`.

## Cost

Parsing, validation and both schemas are computed once, in `createMcp`. Per request only the
filter by the caller's view runs: once for all callers without `can`, once per request with it
(`tools/list` then builds the view too).
