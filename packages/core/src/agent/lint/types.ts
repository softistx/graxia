import type { ErrorCodeName } from '../read';

/** The name of a rule of {@link lintDescriptions}. */
export type LintRule =
	| 'missing-description'
	| 'short-description'
	| 'name-only-description'
	| 'unknown-error-code'
	| 'mutation-without-errors'
	| 'invalid-needs';

/** One finding: where, which rule, what is wrong and how to fix it. */
export interface LintIssue {
	/** The schema coordinate: `Type`, `Type.field`, `Type.field(arg:)`, `Enum.VALUE`, `Input.field`. */
	coordinate: string;
	rule: LintRule;
	message: string;
	fix: string;
}

/** Which kinds of definition must have a description. All default to `true`. */
export interface RequiredDescriptions {
	types?: boolean;
	fields?: boolean;
	arguments?: boolean;
	enumValues?: boolean;
	inputFields?: boolean;
}

/** Options of {@link lintDescriptions}. */
export interface LintDescriptionsOptions {
	/** The shortest description that is not flagged; 12 by default. */
	minLength?: number;
	/** Which definitions need a description; all do by default. */
	require?: RequiredDescriptions;
	/**
	 * The error codes the API may return. When set, a code in `@errors` outside
	 * it is an `unknown-error-code`, and a mutation without `@errors` is a
	 * `mutation-without-errors`.
	 */
	knownErrorCodes?: readonly ErrorCodeName[];
}
