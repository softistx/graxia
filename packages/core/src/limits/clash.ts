import type { GraphQLDirective, GraphQLSchema } from 'graphql';
import { GraxiaConfigError } from '../errors/config-error';
import { costDirective, listSizeDirective } from './directives';

const shapeOf = (directive: GraphQLDirective): string =>
	directive.args
		.map((arg) => `${arg.name}: ${String(arg.type)}`)
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
