import { expectTypeOf } from 'bun:test';
import type { GraphQLDirective, GraphQLSchema } from 'graphql';
import {
	type AgentExtensions,
	agentDirectives,
	agentExtensions,
	agentTypeDefs,
	type Can,
	type Constraint,
	constraintOf,
	errorsOf,
	type LintIssue,
	type LintRule,
	lintDescriptions,
	needsOf,
	printSchemaFor,
	visibleSchema,
} from './index';

declare const schema: GraphQLSchema;

expectTypeOf(agentTypeDefs).toEqualTypeOf<string>();
expectTypeOf(agentDirectives).toEqualTypeOf<readonly GraphQLDirective[]>();
expectTypeOf(printSchemaFor(schema)).toEqualTypeOf<string>();
printSchemaFor(schema, { can: (permission) => permission.startsWith('a:') });
expectTypeOf<Can>().toEqualTypeOf<(permission: string) => boolean>();
expectTypeOf<
	NonNullable<Parameters<typeof printSchemaFor>[1]>['can']
>().toEqualTypeOf<Can | undefined>();
// @ts-expect-error `can` takes a permission name
printSchemaFor(schema, { can: (permission: number) => permission > 1 });

expectTypeOf(lintDescriptions(schema)).toEqualTypeOf<LintIssue[]>();
expectTypeOf<LintIssue['rule']>().toEqualTypeOf<LintRule>();
expectTypeOf<LintIssue>().toHaveProperty('fix').toEqualTypeOf<string>();
lintDescriptions(schema, {
	minLength: 20,
	require: { types: false },
	knownErrorCodes: ['A'],
});
// @ts-expect-error unknown kind of definition
lintDescriptions(schema, { require: { directives: true } });

declare const field: Parameters<typeof errorsOf>[0];
expectTypeOf(needsOf(field)).toEqualTypeOf<string[][]>();
expectTypeOf(errorsOf(field)).toEqualTypeOf<string[]>();
expectTypeOf(constraintOf({} as never)).toEqualTypeOf<Constraint | undefined>();
expectTypeOf(agentExtensions({ needs: 'a' })).toEqualTypeOf<{
	graxia: AgentExtensions;
}>();
// @ts-expect-error the limits are named
agentExtensions({ constraint: { maximum: 3 } });
expectTypeOf(
	visibleSchema(schema, { can: () => true }),
).toEqualTypeOf<GraphQLSchema>();
agentExtensions({ needs: { anyOf: ['a', 'b'] }, errors: 'BAD_USER_INPUT' });
agentExtensions({ needs: ['a', { anyOf: ['b', 'c'] }], errors: ['MY_CODE'] });
// @ts-expect-error a field has no input constraint
constraintOf({} as Parameters<typeof errorsOf>[0]);
// @ts-expect-error an input field has no @needs
needsOf({} as Parameters<typeof constraintOf>[0]);
