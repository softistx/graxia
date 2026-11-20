import { GraxiaConfigError } from '@softistx/graxia';

/** The Envelop hooks graxia runs. */
export const SUPPORTED = new Set([
	'onPluginInit',
	'onSchemaChange',
	'onEnveloped',
	'onParse',
	'onValidate',
	'onContextBuilding',
	'onExecute',
	'onSubscribe',
]);

/** Hooks of graphql-yoga plugins: they belong to the HTTP layer graxia replaces. */
export const YOGA_KEYS = new Set([
	'onRequest',
	'onRequestParse',
	'onParams',
	'onResultProcess',
	'onResponse',
	'onYogaInit',
	'onExecutionResult',
]);

const refuse = (message: string) =>
	new GraxiaConfigError(`fromEnvelop: ${message}`);

/** `envelop plugin 2 of 4 (onParse, instrumentation)`. */
export function labelOf(index: number, total: number, plugin: object): string {
	const keys = Object.entries(plugin)
		.filter(([, value]) => value !== undefined)
		.map(([key]) => key);
	return `envelop plugin ${index} of ${total} (${keys.join(', ')})`;
}

export const notAnObject = (index: number, total: number, value: unknown) =>
	refuse(
		`entry ${index} of ${total} is ${value === null ? 'null' : typeof value}, not an Envelop plugin object. Pass a plugin such as useDepthLimit({ maxDepth: 10 }), or a falsy value (cond && usePlugin()) to skip one.`,
	);

export const instrumentation = (label: string) =>
	refuse(
		`${label} uses "instrumentation", which graxia cannot run. Remove it, or use createGraxia({ telemetry }) or a graxia plugin (definePlugin) instead.`,
	);

export const yogaKey = (label: string, key: string) =>
	refuse(
		`${label} uses "${key}": this is a graphql-yoga plugin, not an Envelop one, and graxia cannot run it. Rewrite it with definePlugin from @softistx/graxia.`,
	);

export const unknownKey = (label: string, key: string) =>
	refuse(
		`${label} uses "${key}", which is not an Envelop hook graxia knows. Check the spelling, or write it as a graxia plugin with definePlugin from @softistx/graxia.`,
	);

export const setSchema = (label: string) =>
	refuse(
		`${label} calls setSchema, which graxia does not honour. Pass the schema to createGraxia({ schema }) instead (useSchema is not needed).`,
	);

export const replaceSchema = (label: string) =>
	refuse(
		`${label} calls replaceSchema, which graxia does not honour: an instance serves the one schema it was created with. Pass the schema to createGraxia({ schema }) instead.`,
	);

export const replaceParseResult = (label: string) =>
	refuse(
		`${label} calls replaceParseResult, which graxia does not honour. Use setParsedDocument in onParse, or throw a GraphQLError there, instead.`,
	);

export const afterValidateSetResult = (label: string) =>
	refuse(
		`${label} calls setResult in the after-hook of onValidate, which graxia does not honour. Call setResult in onValidate itself, or write a graxia plugin (definePlugin) that replaces the errors.`,
	);
