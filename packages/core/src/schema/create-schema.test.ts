import { describe, expect, test } from 'bun:test';
import {
	execute,
	GraphQLError,
	GraphQLScalarType,
	Kind,
	parse,
	subscribe,
} from 'graphql';
import { GraxiaConfigError } from '../errors/config-error';
import { createSchema } from './create-schema';

type Ctx = { user: string };
const ctx: Ctx = { user: 'ada' };
const run = (schema: Parameters<typeof execute>[0]['schema'], query: string) =>
	execute({ schema, document: parse(query), contextValue: ctx });

describe('createSchema typeDefs', () => {
	const resolvers = {
		Query: { me: (_: unknown, __: unknown, c: Ctx) => c.user },
	};

	test('string, with typed context, end to end', async () => {
		const schema = createSchema<Ctx>()({
			typeDefs: 'type Query { me: String }',
			resolvers,
		});
		expect(await run(schema, '{ me }')).toEqual({ data: { me: 'ada' } });
	});

	test('DocumentNode and array with extend type', async () => {
		const schema = createSchema<Ctx>()({
			typeDefs: [
				parse('type Query { me: String }'),
				'extend type Query { two: Int }',
			],
			resolvers: [resolvers, { Query: { two: () => 2 } }],
		});
		expect(await run(schema, '{ me two }')).toEqual({
			data: { me: 'ada', two: 2 },
		});
	});

	test('a single DocumentNode', () => {
		const doc = parse('type Query { a: Int }');
		expect(doc.kind).toBe(Kind.DOCUMENT);
		expect(createSchema()({ typeDefs: doc }).getQueryType()?.name).toBe(
			'Query',
		);
	});

	test('invalid SDL keeps the cause', () => {
		try {
			createSchema()({ typeDefs: 'type Query {' });
			throw new Error('should throw');
		} catch (error) {
			expect(error).toBeInstanceOf(GraxiaConfigError);
			expect((error as GraxiaConfigError).cause).toBeInstanceOf(GraphQLError);
		}
	});

	test('invalid schema throws a config error', () => {
		const run = () => createSchema()({ typeDefs: 'type Foo { a: Int }' });
		expect(run).toThrow(GraxiaConfigError);
		expect(run).toThrow(/Query root type must be provided/);
	});
});

describe('createSchema resolvers errors', () => {
	const typeDefs = 'type Query { a: Int } scalar Date enum Color { RED }';

	test('duplicate field across maps', () => {
		const run = () =>
			createSchema()({
				typeDefs,
				resolvers: [{ Query: { a: () => 1 } }, { Query: { a: () => 2 } }],
			});
		expect(run).toThrow(/Query\.a is defined more than once/);
	});

	test('unknown type and field', () => {
		expect(() =>
			createSchema()({ typeDefs, resolvers: { Nope: { a: () => 1 } } }),
		).toThrow(/no type Nope/);
		expect(() =>
			createSchema()({ typeDefs, resolvers: { Query: { foo: () => 1 } } }),
		).toThrow('Resolver Query.foo is defined but Query has no field foo');
	});

	test('scalar needs a GraphQLScalarType', () => {
		expect(() =>
			createSchema()({ typeDefs, resolvers: { Date: { a: () => 1 } } }),
		).toThrow(/scalar Date must be a GraphQLScalarType/);
	});

	test('missing enum value', () => {
		expect(() =>
			createSchema()({ typeDefs, resolvers: { Color: { BLUE: 'b' } } }),
		).toThrow(/Color\.BLUE .* no value BLUE/);
	});
});

describe('createSchema attachments', () => {
	test('custom scalar parse and serialize', async () => {
		const Upper = new GraphQLScalarType<string, string>({
			name: 'Upper',
			description: 'from scalar',
			serialize: (v) => String(v).toUpperCase(),
			parseValue: (v) => String(v).toLowerCase(),
		});
		const schema = createSchema()({
			typeDefs: 'scalar Upper type Query { echo(v: Upper): Upper }',
			resolvers: { Upper, Query: { echo: (_, a) => a['v'] } },
		});
		expect(schema.getType('Upper')?.description).toBe('from scalar');
		const result = await execute({
			schema,
			document: parse('query($v: Upper) { echo(v: $v) }'),
			variableValues: { v: 'MiXed' },
		});
		expect(result).toEqual({ data: { echo: 'MIXED' } });
	});

	test('SDL description wins over the scalar one', () => {
		const S = new GraphQLScalarType({ name: 'S', description: 'x' });
		const schema = createSchema()({
			typeDefs: '"sdl" scalar S type Query { a: S }',
			resolvers: { S },
		});
		expect(schema.getType('S')?.description).toBe('sdl');
	});

	test('enum internal values, in and out', async () => {
		const schema = createSchema()({
			typeDefs: 'enum Color { RED GREEN } type Query { c(in: Color): Color }',
			resolvers: {
				Color: { RED: 1, GREEN: 2 },
				Query: { c: (_, a) => (a['in'] === 1 ? 2 : 1) },
			},
		});
		expect(await run(schema, '{ c(in: RED) }')).toEqual({
			data: { c: 'GREEN' },
		});
	});

	test('interface __resolveType and union', async () => {
		const schema = createSchema()({
			typeDefs: `
				interface Node { id: ID! }
				type User implements Node { id: ID! name: String }
				type Bot { id: ID! }
				union Who = User | Bot
				type Query { node: Node who: Who }`,
			resolvers: {
				Node: { __resolveType: () => 'User' },
				Who: { __resolveType: (v) => (v.bot ? 'Bot' : 'User') },
				Query: {
					node: () => ({ id: '1', name: 'ada' }),
					who: () => ({ id: '2', bot: true }),
				},
			},
		});
		const result = await run(
			schema,
			'{ node { id ... on User { name } } who { __typename } }',
		);
		expect(result).toEqual({
			data: { node: { id: '1', name: 'ada' }, who: { __typename: 'Bot' } },
		});
	});

	test('__isTypeOf on objects', async () => {
		const schema = createSchema()({
			typeDefs: `
				interface Node { id: ID! }
				type A implements Node { id: ID! }
				type B implements Node { id: ID! }
				type Query { n: Node }`,
			resolvers: {
				A: { __isTypeOf: (v) => v.kind === 'a' },
				B: { __isTypeOf: (v) => v.kind === 'b' },
				Query: { n: () => ({ id: '1', kind: 'b' }) },
			},
		});
		expect(await run(schema, '{ n { __typename } }')).toEqual({
			data: { n: { __typename: 'B' } },
		});
	});

	test('subscription subscribe + resolve', async () => {
		const schema = createSchema()({
			typeDefs: 'type Query { a: Int } type Subscription { tick: Int }',
			resolvers: {
				Subscription: {
					tick: {
						subscribe: async function* () {
							yield 1;
							yield 2;
						},
						resolve: (n: unknown) => (n as number) * 10,
					},
				},
			},
		});
		const stream = await subscribe({
			schema,
			document: parse('subscription { tick }'),
		});
		const seen: unknown[] = [];
		for await (const r of stream as AsyncIterable<{ data: unknown }>)
			seen.push(r.data);
		expect(seen).toEqual([{ tick: 10 }, { tick: 20 }]);
	});
});
