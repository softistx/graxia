import { describe, expect, test } from 'bun:test';
import {
	buildSchema,
	GraphQLID,
	GraphQLObjectType,
	GraphQLSchema,
	GraphQLString,
	specifiedDirectives,
} from 'graphql';
import { agentDirectives, agentTypeDefs } from './directives';
import { library } from './fixtures.test-util';
import { printSchemaFor } from './print';
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

	test('a Query that is left empty is dropped and the other roots stay', () => {
		const schema = buildSchema(`${agentTypeDefs}
			type Query { a: String @needs(permission: "x") }
			type Mutation { b: String }`);
		const sdl = printSchemaFor(schema, as());
		expect(sdl).toContain('schema {\n  mutation: Mutation\n}');
		expect(sdl).not.toContain('type Query');
		expect(() => buildSchema(sdl)).not.toThrow();
		expect(
			printSchemaFor(
				buildSchema(
					`${agentTypeDefs} type Query { a: String @needs(permission: "x") }`,
				),
				as(),
			),
		).toBe('');
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

	test('an object drops an interface whose fields it no longer has', () => {
		const schema = buildSchema(`${agentTypeDefs}
			type Query { n: Node a: A }
			interface Node { id: ID! }
			type A implements Node { id: ID! @needs(permission: "x") name: String }`);
		const sdl = printSchemaFor(schema, as());
		expect(sdl).toContain('type A {');
		expect(() => buildSchema(sdl)).not.toThrow();
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
