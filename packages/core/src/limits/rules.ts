import type { ValidationRule } from 'graphql';
import { limitError } from './error';
import type { ResolvedOperationLimits } from './options';
import { createWalker, fragmentMap } from './walk';

/**
 * One validation rule that enforces `depth`, `aliases`, `directives` and
 * `rootFields` on each operation (none when all four are off). One error per
 * limit exceeded.
 */
export function operationLimitRules(
	limits: ResolvedOperationLimits,
): readonly ValidationRule[] {
	const { depth, aliases, directives, rootFields } = limits;
	if (
		depth === false &&
		aliases === false &&
		directives === false &&
		rootFields === false
	)
		return [];
	return [
		(context) => {
			const walker = createWalker(fragmentMap(context.getDocument()));
			return {
				OperationDefinition(node) {
					const stats = walker.operation(node);
					const check = (
						name: string,
						max: number | false,
						actual: number,
						message: string,
						fix: string,
					) => {
						if (max !== false && actual > max)
							context.reportError(
								limitError(message, { name, max, actual }, fix, node),
							);
					};
					check(
						'depth',
						depth,
						stats.depth,
						`Operation depth ${stats.depth} exceeds the limit of ${depth}.`,
						'Ask for fewer nested fields or raise limits.depth.',
					);
					check(
						'aliases',
						aliases,
						stats.aliases,
						`Operation has ${stats.aliases} aliases, over the limit of ${aliases}.`,
						'Use fewer aliases or raise limits.aliases.',
					);
					check(
						'directives',
						directives,
						stats.directives,
						`Operation has ${stats.directives} directives, over the limit of ${directives}.`,
						'Use fewer directives or raise limits.directives.',
					);
					check(
						'rootFields',
						rootFields,
						stats.fields,
						`Operation has ${stats.fields} root fields, over the limit of ${rootFields}.`,
						'Split the operation or raise limits.rootFields.',
					);
				},
			};
		},
	];
}
