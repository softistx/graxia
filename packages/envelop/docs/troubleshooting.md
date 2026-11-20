# Troubleshooting

The errors a consumer can hit, headed by the message as it appears. All are a `GraxiaConfigError` thrown by `fromEnvelop`
at boot, unless said otherwise. Every message starts with `fromEnvelop: envelop plugin N of M (hooks)` or
`fromEnvelop: entry N of M`; the headings below match from the verb on.

## entry N of M is X, not an Envelop plugin object

`fromEnvelop` was given a string, number or other non-object. Pass a plugin such as `useDepthLimit({ maxDepth: 10 })`, or a
falsy value (`cond && usePlugin()`) to skip one.

## uses "instrumentation", which graxia cannot run

An Envelop plugin carries `instrumentation`. Remove it, or use `createGraxia({ telemetry })` or a graxia plugin
(`definePlugin`) instead.

## uses "onRequest": this is a graphql-yoga plugin, not an Envelop one

A plugin uses a graphql-yoga hook (`onRequest`, `onRequestParse`, `onParams`, `onResultProcess`, `onResponse`,
`onYogaInit`, `onExecutionResult`). They belong to the HTTP layer graxia replaces: rewrite the plugin with `definePlugin`
from `@graxia/core`.

## uses "onXxx", which is not an Envelop hook graxia knows

The hook name is misspelt or not an Envelop hook. Check the spelling, or write it as a graxia plugin.

## calls setSchema, which graxia does not honour

An Envelop plugin tried `setSchema`. Pass the schema to `createGraxia({ schema })` (`useSchema` is not needed).

## calls replaceSchema, which graxia does not honour

Raised while `graxia.ready` resolves: an instance serves the one schema it was created with. Pass the schema to
`createGraxia({ schema })`.

## calls replaceParseResult, which graxia does not honour

Use `setParsedDocument` in `onParse`, or throw a `GraphQLError` there.

## calls setResult in the after-hook of onValidate, which graxia does not honour

Call `setResult` in `onValidate` itself, or write a graxia plugin that replaces the errors.

## Must provide a query string.

This is not a `GraxiaConfigError` but an HTTP 400 response. A persisted-operations request with an id and no `query` is refused by core before any plugin runs. Send a placeholder
`query` with the id, or use core's `trustedDocuments` with `documentId`.
