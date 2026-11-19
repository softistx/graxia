import type { GraphQLField } from 'graphql';
import type { ErrorCodeName } from '../read';
import { errorsOf } from '../read';
import type { LintIssue } from './types';

/** The `@errors` issues of a field: unknown codes and, on a mutation, no codes at all. */
export function lintErrorCodes(
	coordinate: string,
	field: GraphQLField<any, any>,
	known: readonly ErrorCodeName[] | undefined,
	isMutation: boolean,
): LintIssue[] {
	if (!known) return [];
	const codes = errorsOf(field);
	const issues: LintIssue[] = [];
	for (const code of codes.filter((c) => !known.includes(c)))
		issues.push({
			coordinate,
			rule: 'unknown-error-code',
			message: `@errors on ${coordinate} lists ${code}, which is not a known error code.`,
			fix: `Use one of the known codes (${known.join(', ')}), or add ${code} to knownErrorCodes.`,
		});
	if (isMutation && codes.length === 0)
		issues.push({
			coordinate,
			rule: 'mutation-without-errors',
			message: `The mutation ${coordinate} does not say which errors it may return.`,
			fix: `Add @errors(codes: [...]) to ${coordinate} with the codes a caller can get.`,
		});
	return issues;
}
