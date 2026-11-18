import { GraphQLError, type ValidationRule } from 'graphql';
import { VALIDATION_FAILED } from '../document/types';

/**
 * A validation rule that refuses `__schema` and `__type` (`__typename` stays
 * allowed), used when `introspection` is `false`.
 */
export const noIntrospectionRule: ValidationRule = (context) => ({
	Field(node) {
		const name = node.name.value;
		if (name !== '__schema' && name !== '__type') return;
		context.reportError(
			new GraphQLError(
				'GraphQL introspection is not allowed, but the query contained __schema or __type.',
				{
					nodes: [node],
					extensions: {
						code: VALIDATION_FAILED,
						fix: 'Set introspection: true in createGraxia to allow introspection queries (it is off when NODE_ENV is "production").',
					},
				},
			),
		);
	},
});
