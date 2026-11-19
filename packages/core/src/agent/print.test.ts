import { describe, expect, test } from 'bun:test';
import {
	buildSchema,
	GraphQLEnumType,
	GraphQLID,
	GraphQLInputObjectType,
	GraphQLInt,
	GraphQLList,
	GraphQLObjectType,
	GraphQLSchema,
	GraphQLString,
	specifiedDirectives,
	validateSchema,
} from 'graphql';
import { agentDirectives, agentTypeDefs } from './directives';
import { library } from './fixtures.test-util';
import { printSchemaFor, visibleSchema } from './print';
import { agentExtensions } from './read';

const as = (...granted: string[]) => ({
	can: (permission: string) => granted.includes(permission),
});

describe('printSchemaFor', () => {
	test('without can, everything reachable is printed and the output builds', () => {
		const sdl = printSchemaFor(library);
		expect(sdl).toContain('directive @needs');
		expect(sdl).toContain(
			'members: [Member!]! @needs(permission: "members:read")',
		);
		expect(sdl).toContain(
			'type Member implements Node @needs(permission: "members:read")',
		);
		expect(() => buildSchema(sdl)).not.toThrow();
	});

	test('a field the caller cannot use is removed, a type left empty goes with its fields', () => {
		const sdl = printSchemaFor(library, as());
		expect(sdl).not.toContain('members');
		expect(sdl).not.toContain('type Member');
		expect(sdl).not.toContain('type Note');
		expect(sdl).not.toContain('addBook');
		expect(sdl).not.toContain('Mutation');
		expect(sdl).toContain('type Book implements Node');
		// Book.borrower returns Member, which is gone: the field goes too.
		expect(sdl).not.toContain('borrower');
		expect(() => buildSchema(sdl)).not.toThrow();
	});

	test('a union loses its hidden member, and goes when none is left', () => {
		const some = printSchemaFor(library, as());
		expect(some).not.toContain('SearchHit');
		const all = printSchemaFor(library, as('members:read'));
		expect(all).toContain('union SearchHit = Book | Member');
	});

	test('all permissions of a repeated @needs are required', () => {
		const schema = buildSchema(`${agentTypeDefs}
			type Query { a: String @needs(permission: "x") @needs(permission: "y") b: String }`);
		expect(printSchemaFor(schema, as('x'))).not.toContain('a:');
		expect(printSchemaFor(schema, as('x', 'y'))).toContain('a: String');
	});

	test('removal repeats to a fixed point', () => {
		const schema = buildSchema(`${agentTypeDefs}
			type Query { a: A b: String }
			type A { b: B }
			type B { c: C }
			type C { secret: String @needs(permission: "s") }`);
		const sdl = printSchemaFor(schema, as());
		expect(sdl).toBe('type Query {\n  b: String\n}\n');
	});

	test('types no kept root reaches are dropped', () => {
		const schema = buildSchema(
			'type Query { a: String } type Orphan { x: Int }',
		);
		expect(printSchemaFor(schema)).not.toContain('Orphan');
	});

	test('a Query left empty keeps one placeholder field, the other roots stay, and the schema is valid', () => {
		const schema = buildSchema(`${agentTypeDefs}
			type Query { a: String @needs(permission: "x") }
			type Mutation { b: String }`);
		const sdl = printSchemaFor(schema, as());
		expect(sdl).toContain(
			'"Placeholder: no query field is visible to this caller."\n  _empty: Boolean',
		);
		expect(sdl).toContain('type Mutation');
		expect(validateSchema(buildSchema(sdl))).toEqual([]);
		const nothing = printSchemaFor(
			buildSchema(
				`${agentTypeDefs} type Query { a: String @needs(permission: "x") }`,
			),
			as(),
		);
		expect(nothing).toContain('type Query');
		expect(nothing).toContain('_empty: Boolean');
		expect(validateSchema(buildSchema(nothing))).toEqual([]);
	});

	test('visibleSchema is the valid schema the print describes', () => {
		const visible = visibleSchema(library, as());
		expect(validateSchema(visible)).toEqual([]);
		expect(visible.getType('Member')).toBeUndefined();
		expect(visible.getType('Book')).toBeDefined();
		expect(printSchemaFor(visible)).toBe(printSchemaFor(library, as()));
	});

	test('anyOf is met by one permission, repeated @needs all, and both print back', () => {
		const schema = buildSchema(`${agentTypeDefs}
			type Query {
				a: String @needs(anyOf: ["x", "y"])
				b: String @needs(anyOf: ["x", "y"]) @needs(permission: "z")
				c: String
			}`);
		const names = (...g: string[]) =>
			[...printSchemaFor(schema, as(...g)).matchAll(/^ {2}(\w+):/gm)].map(
				(m) => m[1],
			);
		expect(names('y')).toEqual(['a', 'c']);
		expect(names('y', 'z')).toEqual(['a', 'b', 'c']);
		expect(names()).toEqual(['c']);
		expect(printSchemaFor(schema)).toContain(
			'a: String @needs(anyOf: ["x", "y"])',
		);
		expect(printSchemaFor(schema)).toContain(
			'@needs(anyOf: ["x", "y"]) @needs(permission: "z")',
		);
	});

	test('an invalid @needs (both arguments, or neither) hides the field', () => {
		const schema = buildSchema(`${agentTypeDefs}
			type Query { a: String @needs(permission: "x", anyOf: ["x"]) c: String }`);
		expect(printSchemaFor(schema, as('x'))).not.toContain('a: String');
		expect(printSchemaFor(schema, as('x'))).toContain('c: String');
	});

	test('applied directives, descriptions, deprecations and specifiedBy are kept', () => {
		const sdl = printSchemaFor(library, as('members:read', 'books:write'));
		expect(sdl).toContain('first: Int = 10 @constraint(min: 1, max: 100)');
		expect(sdl).toContain(
			'search: String @constraint(minLength: 2, maxLength: 80)',
		);
		expect(sdl).toContain('@errors(codes: ["BAD_USER_INPUT", "CONFLICT"])');
		expect(sdl).toContain('@deprecated(reason: "Use FICTION.")');
		expect(sdl).toContain(
			'scalar Day @specifiedBy(url: "https://example.com/day")',
		);
		expect(sdl).toContain('input Pick @oneOf');
		expect(sdl).toContain('"The library API."');
		const rebuilt = buildSchema(sdl);
		expect(rebuilt.getType('Day')).toBeDefined();
	});

	test('it round-trips: printing the output again changes nothing', () => {
		const once = printSchemaFor(library, as('members:read'));
		expect(printSchemaFor(buildSchema(once), as('members:read'))).toBe(once);
	});

	test('it leaves out @defer, @stream, introspection and built-in scalars', () => {
		const sdl = printSchemaFor(library);
		expect(sdl).not.toMatch(/directive @(defer|stream|include|skip)/);
		expect(sdl).not.toContain('__Schema');
		expect(sdl).not.toMatch(/^scalar (String|ID|Int)/m);
	});

	test('only the directives the output uses are defined', () => {
		const plain = buildSchema('type Query { a: String }');
		expect(printSchemaFor(plain)).not.toContain('directive');
		const sdl = printSchemaFor(library, as());
		expect(sdl).toContain('directive @constraint');
		expect(sdl).toContain('directive @errors');
		expect(sdl).not.toContain('directive @needs');
	});

	test('an implementer reachable only through its interface keeps implements and its fields', () => {
		const schema = buildSchema(`${agentTypeDefs}
			type Query { node: Node }
			interface Node { id: ID! secret: String }
			type User implements Node { id: ID! secret: String @needs(permission: "x") name: String }`);
		const sdl = printSchemaFor(schema, as());
		expect(sdl).toContain('type User implements Node {');
		expect(sdl).toContain('name: String');
		expect(sdl).not.toContain('secret');
		expect(validateSchema(buildSchema(sdl))).toEqual([]);
	});

	test('an interface left with no field is removed like any empty type', () => {
		const schema = buildSchema(`${agentTypeDefs}
			type Query { u: User }
			interface Node { id: ID! }
			type User implements Node { id: ID! @needs(permission: "x") name: String }`);
		const sdl = printSchemaFor(schema, as());
		expect(sdl).toContain('type User {');
		expect(sdl).not.toContain('interface Node');
		expect(validateSchema(buildSchema(sdl))).toEqual([]);
	});

	test('code-built default values print through their GraphQL type', () => {
		const Color = new GraphQLEnumType({
			name: 'Color',
			description: 'A colour of the shelf.',
			values: { RED: { value: 1, description: 'Red covers.' } },
		});
		const Box = new GraphQLInputObjectType({
			name: 'Box',
			description: 'A box to search in.',
			fields: {
				size: { type: GraphQLInt, description: 'Its size in cm.' },
			},
		});
		const built = new GraphQLSchema({
			query: new GraphQLObjectType({
				name: 'Query',
				description: 'The root of the API.',
				fields: {
					f: {
						type: GraphQLString,
						description: 'A field with defaults.',
						args: {
							c: { type: Color, defaultValue: 1, description: 'A colour.' },
							l: {
								type: new GraphQLList(GraphQLInt),
								defaultValue: [1, 2],
								description: 'Some numbers.',
							},
							b: {
								type: Box,
								defaultValue: { size: 3 },
								description: 'A box.',
							},
							s: {
								type: GraphQLString,
								defaultValue: 'a"b',
								description: 'A text.',
							},
							n: {
								type: GraphQLString,
								defaultValue: null,
								description: 'Nothing.',
							},
						},
					},
				},
			}),
		});
		const sdl = printSchemaFor(built);
		expect(sdl).toContain('c: Color = RED');
		expect(sdl).toContain('l: [Int] = [1, 2]');
		expect(sdl).toContain('b: Box = { size: 3 }');
		expect(sdl).toContain('s: String = "a\\"b"');
		expect(sdl).toContain('n: String = null');
		expect(validateSchema(buildSchema(sdl))).toEqual([]);
	});

	test('a schema built in code carries its agent metadata through extensions', () => {
		const query = new GraphQLObjectType({
			name: 'Query',
			fields: {
				open: { type: GraphQLString },
				closed: {
					type: GraphQLString,
					extensions: agentExtensions({
						needs: 'admin',
						errors: ['FORBIDDEN'],
					}),
				},
				find: {
					type: GraphQLID,
					args: {
						text: {
							type: GraphQLString,
							extensions: agentExtensions({ constraint: { maxLength: 5 } }),
						},
					},
				},
			},
		});
		const schema = new GraphQLSchema({
			query,
			directives: [...specifiedDirectives, ...agentDirectives],
		});
		const hidden = printSchemaFor(schema, as());
		expect(hidden).not.toContain('closed');
		expect(hidden).toContain(
			'find(text: String @constraint(maxLength: 5)): ID',
		);
		const shown = printSchemaFor(schema, as('admin'));
		expect(shown).toContain(
			'closed: String @needs(permission: "admin") @errors(codes: ["FORBIDDEN"])',
		);
		expect(() => buildSchema(shown)).not.toThrow();
	});

	test('the output is deterministic', () => {
		expect(printSchemaFor(library, as('members:read'))).toBe(
			printSchemaFor(library, as('members:read')),
		);
	});
});
