import type { DocumentNode, ExecutionResult } from 'graphql';
import { createStateKey } from '../plugins/state';

/**
 * @internal The already parsed document `execute` was given and the text it
 * was printed as: parse is skipped only while the operation's query is still
 * that text (an `onParams` hook may replace it).
 */
export const presetDocumentKey = createStateKey<{
	node: DocumentNode;
	text: string;
}>('graxia.execute.document');

/** @internal Set on the synthetic request of `execute`: no browser sent it, so the CSRF and origin checks skip it. */
export const inProcessKey = createStateKey<true>('graxia.execute.inProcess');

/** @internal The masked result of the operation, recorded for `execute`. */
export const resultKey = createStateKey<ExecutionResult>(
	'graxia.execute.result',
);

/** @internal The first unexpected error of the request, kept for `GraxiaExecuteError.cause`. */
export const unexpectedErrorKey = createStateKey<{ error: unknown }>(
	'graxia.execute.unexpected',
);
