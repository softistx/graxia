import { describe, expect, test } from 'bun:test';
import {
	buildSchema,
	extendSchema,
	GraphQLObjectType,
	GraphQLSchema,
	GraphQLString,
	parse,
} from 'graphql';
import { agentTypeDefs } from './directives';
import {
	agentExtensions,
	constraintOf,
	errorsOf,
	hasInvalidNeeds,
	needsOf,
} from './read';

describe('reading the agent directives', () => {
	const schema = buildSchema(`${agentTypeDefs}
		type Query {
			a(text: String @constraint(minLength: 1, pattern: "^a", format: "email")): String
				@needs(permission: "x") @needs(permission: "y") @errors(codes: ["A", "B"])
			b: String
		}
		type Thing @needs(permission: "t") { c: Int }
		input In { n: Int @constraint(min: 0.5, max: 9) }`);
	const query = schema.getQueryType() as GraphQLObjectType;

	test('needsOf lists every @needs of a field, a type, and none otherwise', () => {
		expect(needsOf(query.getFields()['a']!)).toEqual([['x'], ['y']]);
		expect(needsOf(query.getFields()['b']!)).toEqual([]);
		expect(needsOf(schema.getType('Thing') as GraphQLObjectType)).toEqual([
			['t'],
		]);
	});

	test('constraintOf reads an argument and an input field', () => {
		const arg = query.getFields()['a']!.args[0]!;
		expect(constraintOf(arg)).toEqual({
			minLength: 1,
			pattern: '^a',
			format: 'email',
		});
		const input = schema.getType('In') as any;
		expect(constraintOf(input.getFields()['n'])).toEqual({ min: 0.5, max: 9 });
		const plain = buildSchema('type Query { f(x: Int): Int }');
		const field = (plain.getQueryType() as GraphQLObjectType).getFields()['f']!;
		expect(constraintOf(field.args[0]!)).toBeUndefined();
	});

	test('errorsOf lists the codes', () => {
		expect(errorsOf(query.getFields()['a']!)).toEqual(['A', 'B']);
		expect(errorsOf(query.getFields()['b']!)).toEqual([]);
	});

	test('a type extension carries @needs too', () => {
		const extended = extendSchema(
			schema,
			parse('extend type Thing @needs(permission: "more")'),
		);
		expect(needsOf(extended.getType('Thing') as GraphQLObjectType)).toEqual([
			['t'],
			['more'],
		]);
	});

	test('extensions.graxia is read on a code-built schema, one name or several', () => {
		const built = new GraphQLSchema({
			query: new GraphQLObjectType({
				name: 'Query',
				fields: {
					a: {
						type: GraphQLString,
						extensions: agentExtensions({ needs: 'x', errors: ['A'] }),
						args: {
							t: {
								type: GraphQLString,
								extensions: agentExtensions({ constraint: { maxLength: 3 } }),
							},
						},
					},
					b: {
						type: GraphQLString,
						extensions: agentExtensions({ needs: ['x', 'y'] }),
					},
				},
			}),
		});
		const fields = (built.getQueryType() as GraphQLObjectType).getFields();
		expect(needsOf(fields['a']!)).toEqual([['x']]);
		expect(needsOf(fields['b']!)).toEqual([['x'], ['y']]);
		expect(errorsOf(fields['a']!)).toEqual(['A']);
		expect(constraintOf(fields['a']!.args[0]!)).toEqual({ maxLength: 3 });
	});

	test('anyOf is an OR group, repeated @needs are ANDed, and a code-built anyOf reads the same', () => {
		const sdl = buildSchema(`${agentTypeDefs}
			type Query {
				a: String @needs(anyOf: ["x", "y"]) @needs(permission: "z")
				both: String @needs(permission: "x", anyOf: ["y"])
				neither: String @needs
			}`);
		const fields = (sdl.getQueryType() as GraphQLObjectType).getFields();
		expect(needsOf(fields['a']!)).toEqual([['x', 'y'], ['z']]);
		expect(hasInvalidNeeds(fields['a']!)).toBe(false);
		expect(needsOf(fields['both']!)).toEqual([[]]);
		expect(hasInvalidNeeds(fields['both']!)).toBe(true);
		expect(hasInvalidNeeds(fields['neither']!)).toBe(true);
		const built = new GraphQLSchema({
			query: new GraphQLObjectType({
				name: 'Query',
				fields: {
					a: {
						type: GraphQLString,
						extensions: agentExtensions({
							needs: [{ anyOf: ['x', 'y'] }, 'z'],
							errors: 'A',
						}),
					},
				},
			}),
		});
		const field = (built.getQueryType() as GraphQLObjectType).getFields()['a']!;
		expect(needsOf(field)).toEqual([['x', 'y'], ['z']]);
		expect(errorsOf(field)).toEqual(['A']);
	});

	test('a code-built needs with an empty or invalid anyOf is invalid and hides the field', () => {
		const field = (extensions: unknown) =>
			(
				new GraphQLSchema({
					query: new GraphQLObjectType({
						name: 'Query',
						fields: {
							a: { type: GraphQLString, extensions: extensions as never },
						},
					}),
				}).getQueryType() as GraphQLObjectType
			).getFields()['a']!;
		for (const needs of [
			{ anyOf: [] },
			{ anyOf: 'x' },
			{ anyOf: [1] },
			['z', { anyOf: [] }],
		]) {
			const f = field({ graxia: { needs } });
			expect(hasInvalidNeeds(f)).toBe(true);
			expect(needsOf(f).some((g) => g.length === 0)).toBe(true);
		}
		expect(
			hasInvalidNeeds(field({ graxia: { needs: { anyOf: ['x'] } } })),
		).toBe(false);
	});

	test('the new limits are read', () => {
		const limits = buildSchema(`${agentTypeDefs}
			type Query { f(n: Float @constraint(exclusiveMin: 0, exclusiveMax: 10, multipleOf: 0.5), l: [Int] @constraint(minItems: 1, maxItems: 3)): Int }`);
		const field = (limits.getQueryType() as GraphQLObjectType).getFields()[
			'f'
		]!;
		expect(constraintOf(field.args[0]!)).toEqual({
			exclusiveMin: 0,
			exclusiveMax: 10,
			multipleOf: 0.5,
		});
		expect(constraintOf(field.args[1]!)).toEqual({ minItems: 1, maxItems: 3 });
	});
});
