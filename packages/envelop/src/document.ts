import { documentStringMap } from '@envelop/core';
import type {
	GraxiaPlugin,
	OnParseDone,
	OnParsePayload,
	OnValidateDone,
	OnValidatePayload,
} from '@graxia/core';
import { GraphQLError, parse, validate } from 'graphql';
import { extender, type opKey, opOf } from './early-context';
import * as refuse from './refuse';
import type { Adapter, Entry } from './types';

type Key = ReturnType<typeof opKey>;
type Hooks = Pick<GraxiaPlugin, 'onParse' | 'onValidate'>;
type Maybe<T> = T | undefined;

/** `onParse` and `onValidate` of the adapter: the Envelop plugins' hooks of the same names, in order. */
export function documentHooks(adapter: Adapter, key: Key): Hooks {
	const parsers = adapter.entries.filter((e) => e.plugin.onParse);
	const validators = adapter.entries.filter((e) => e.plugin.onValidate);
	return {
		...(parsers.length > 0 && {
			onParse: (payload) => runParse(parsers, key, payload),
		}),
		...(validators.length > 0 && {
			onValidate: (payload) => runValidate(validators, key, payload),
		}),
	};
}

type AfterParse = (payload: never) => unknown;

function runParse(
	entries: readonly Entry[],
	key: Key,
	payload: OnParsePayload,
): (done: OnParseDone) => void {
	const op = opOf(key, payload.state, payload);
	const extendContext = extender(op);
	const source = payload.params.query ?? '';
	let parseFn: (source: string) => unknown = parse;
	let document: unknown;
	const afters: { entry: Entry; after: AfterParse }[] = [];
	try {
		for (const entry of entries) {
			const after = entry.plugin.onParse?.({
				context: op.context,
				extendContext,
				params: { source },
				parseFn: parseFn as never,
				setParseFn: (next) => {
					parseFn = next as never;
				},
				setParsedDocument: (next) => {
					document = next;
				},
			});
			if (typeof after === 'function')
				afters.push({ entry, after: after as AfterParse });
		}
	} catch (error) {
		// A GraphQLError is the client's answer: it is raised from the parse step,
		// which core answers with it (an `onParse` hook that throws is a 500).
		if (!(error instanceof GraphQLError)) throw error;
		payload.setParseFn(() => {
			throw error;
		});
		return () => {};
	}
	if (document) payload.setDocument(document as never);
	else if (parseFn !== parse) payload.setParseFn(parseFn as never);
	return ({ document: parsed }) => {
		if (parsed) documentStringMap.set(parsed, source);
		for (const { entry, after } of afters) {
			(after as (p: unknown) => void)({
				context: op.context,
				extendContext,
				result: parsed ?? null,
				replaceParseResult: () => {
					throw refuse.replaceParseResult(entry.label);
				},
			});
		}
	};
}

function runValidate(
	entries: readonly Entry[],
	key: Key,
	payload: OnValidatePayload,
): (done: OnValidateDone) => void {
	const op = opOf(key, payload.state, { request: payload.request, params: {} });
	const extendContext = extender(op);
	const { schema, document } = payload;
	let validateFn: (...args: never[]) => unknown = validate as never;
	let result: Maybe<readonly GraphQLError[]>;
	const afters: { entry: Entry; after: AfterParse }[] = [];
	for (const entry of entries) {
		const after = entry.plugin.onValidate?.({
			context: op.context,
			extendContext,
			params: { schema, documentAST: document },
			validateFn: validateFn as never,
			addValidationRule: (rule) => payload.addRule(rule),
			setValidationFn: (next) => {
				validateFn = next as never;
			},
			setResult: (errors) => {
				result = errors as GraphQLError[];
			},
		});
		if (typeof after === 'function')
			afters.push({ entry, after: after as AfterParse });
	}
	if (result) payload.setResult(result);
	else if (validateFn !== (validate as never))
		payload.setValidationFn((s, d, rules) =>
			(validateFn as (...a: unknown[]) => readonly GraphQLError[])(s, d, rules),
		);
	return ({ errors }) => {
		if (!errors) return;
		for (const { entry, after } of afters) {
			(after as (p: unknown) => void)({
				context: op.context,
				extendContext,
				valid: errors.length === 0,
				result: errors,
				setResult: () => {
					throw refuse.afterValidateSetResult(entry.label);
				},
			});
		}
	};
}
