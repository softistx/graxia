import type { DocumentNode, ExecutionResult } from 'graphql';
import { createStateKey } from '../plugins/state';

/** @internal The already parsed document `execute` was given (parse is skipped). */
export const presetDocumentKey = createStateKey<DocumentNode>(
	'graxia.execute.document',
);

/** @internal The masked result of the operation, recorded for `execute`. */
export const resultKey = createStateKey<ExecutionResult>(
	'graxia.execute.result',
);
