import { type GraphQLDirective, type GraphQLSchema, print } from 'graphql';
import { GraxiaConfigError } from '../errors/config-error';
import { costDirective, listSizeDirective } from './directives';

type Arg = GraphQLDirective['args'][number];

/** The default of an argument, whichever way graphql 17 recorded it (`default`, or the deprecated `defaultValue`). */
const defaultOf = (arg: Arg): string => {
	const input = arg.default;
	if (input)
		return 'literal' in input
			? print(input.literal)
			: JSON.stringify(input.value);
	return arg.defaultValue === undefined ? '' : JSON.stringify(arg.defaultValue);
};

const shapeOf = (directive: GraphQLDirective): string =>
	directive.args
		.map(
			(arg) =>
				`${arg.name}: ${String(arg.type)}${
					defaultOf(arg) === '' ? '' : ` = ${defaultOf(arg)}`
				}`,
		)
		.sort()
		.join(', ');

/**
 * Throws when the schema declares `@cost` or `@listSize` with another shape
 * than graxia's: the cost limit would read the user's directive with graxia's
 * definition and fail on every operation. Skipped when the cost limit is off.
 */
export function assertCostDirectives(schema: GraphQLSchema): void {
	for (const ours of [costDirective, listSizeDirective]) {
		const theirs = schema.getDirective(ours.name);
		if (!theirs || shapeOf(theirs) === shapeOf(ours)) continue;
		throw new GraxiaConfigError(
			`The schema declares @${ours.name}(${shapeOf(theirs)}) but graxia's limits.cost reads @${ours.name}(${shapeOf(ours)}). Rename or drop your directive, or turn the cost limit off with limits: { cost: false }.`,
		);
	}
}
