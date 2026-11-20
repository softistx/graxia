import { describe, expect, test } from 'bun:test';
import {
	buildASTSchema,
	GraphQLSchema,
	isSpecifiedDirective,
	parse,
	printSchema,
} from 'graphql';
import { createSchema } from '../schema/create-schema';
import { costDirectives, withCostDefinitions } from './directives';

const expected = {
	cost: ['weight'],
	listSize: [
		'assumedSize',
		'requireOneSlicingArgument',
		'sizedFields',
		'slicingArguments',
	],
};

const typeDefs = 'type Query { a: Int }';

describe('cost directive descriptions', () => {
	test('every directive createSchema adds, and each argument, is described', () => {
		const schema = createSchema()({ typeDefs, resolvers: {} });
		const added = schema
			.getDirectives()
			.filter((directive) => !isSpecifiedDirective(directive));
		expect(added.map((directive) => directive.name).sort()).toEqual(
			expect.arrayContaining(['cost', 'listSize']),
		);
		for (const directive of added) {
			expect(directive.description?.trim()).toBeTruthy();
			expect(directive.args.map((arg) => arg.name).sort()).toEqual(
				expected[directive.name as keyof typeof expected].slice().sort(),
			);
			for (const arg of directive.args)
				expect(arg.description?.trim()).toBeTruthy();
		}
	});

	test('the objects and the SDL carry the same descriptions', () => {
		const fromSdl = buildASTSchema(withCostDefinitions(parse(typeDefs)));
		for (const directive of costDirectives) {
			const sdl = fromSdl.getDirective(directive.name);
			expect(sdl?.description).toBe(directive.description ?? undefined);
			for (const arg of directive.args)
				expect(sdl?.args.find((a) => a.name === arg.name)?.description).toBe(
					arg.description ?? undefined,
				);
		}
		const fromObjects = new GraphQLSchema({
			directives: [...costDirectives],
		});
		const print = (schema: GraphQLSchema) =>
			printSchema(schema)
				.split('\n\n')
				.filter((block) => /directive @(cost|listSize)\b/.test(block))
				.sort()
				.join('\n\n');
		expect(print(fromSdl)).toBe(print(fromObjects));
	});
});
