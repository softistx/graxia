import { describe, expect, test } from 'bun:test';
import { buildSchema } from 'graphql';
import { agentTypeDefs } from './directives';
import { type LintRule, lintDescriptions } from './lint';

const lint = (sdl: string, options?: Parameters<typeof lintDescriptions>[1]) =>
	lintDescriptions(buildSchema(`${agentTypeDefs}\n${sdl}`), options);
const rules = (issues: { rule: LintRule }[]) => issues.map((i) => i.rule);

describe('lintDescriptions', () => {
	test('a well described schema has no issue', () => {
		const sdl = `
			"The root of the API."
			type Query {
				"Says hello to the caller."
				hello(
					"Whom to greet, by first name."
					who: String
				): String @errors(codes: ["BAD_USER_INPUT"])
			}
			"The writes of the API."
			type Mutation {
				"Changes the greeting for everyone."
				setGreeting("The new greeting text." text: String!): String @errors(codes: ["CONFLICT"])
			}`;
		expect(
			lint(sdl, { knownErrorCodes: ['BAD_USER_INPUT', 'CONFLICT'] }),
		).toEqual([]);
	});

	test('missing-description, with the schema coordinate of each kind', () => {
		const issues = lint(`
			type Query { a(arg: Int): E }
			enum E { ONE }
			input I { x: Int }
			scalar S`);
		expect(issues.map((i) => i.coordinate)).toEqual([
			'E',
			'E.ONE',
			'I',
			'I.x',
			'Query',
			'Query.a',
			'Query.a(arg:)',
			'S',
		]);
		expect(new Set(rules(issues))).toEqual(new Set(['missing-description']));
	});

	test('a described schema without missing parts has none', () => {
		expect(
			lint(
				`"The root of the API." type Query { "Says hello to the caller." hello: String }`,
			),
		).toEqual([]);
	});

	test('short-description: under minLength, and minLength is an option', () => {
		const sdl = `"Root." type Query { "A greeting." hello: String }`;
		expect(rules(lint(sdl))).toEqual([
			'short-description',
			'short-description',
		]);
		expect(lint(sdl, { minLength: 5 })).toEqual([]);
	});

	test('name-only-description: the name said again', () => {
		const issues = lint(`
			"The root of the API."
			type Query {
				"The id."
				id: ID
				"The book title."
				bookTitle: String
				"The unique identifier of the record."
				recordId: ID
			}`);
		expect(issues.map((i) => [i.coordinate, i.rule])).toEqual([
			['Query.bookTitle', 'name-only-description'],
			['Query.id', 'name-only-description'],
		]);
	});

	test('require turns a kind off', () => {
		const sdl = `"The root of the API." type Query { hello(arg: Int): String }`;
		expect(rules(lint(sdl))).toEqual([
			'missing-description',
			'missing-description',
		]);
		expect(lint(sdl, { require: { fields: false, arguments: false } })).toEqual(
			[],
		);
	});

	test('a description is still checked for length when it is not required', () => {
		const sdl = `"The root of the API." type Query { "Hi." hello: String }`;
		expect(rules(lint(sdl, { require: { fields: false } }))).toEqual([
			'short-description',
		]);
	});

	test('unknown-error-code and mutation-without-errors need knownErrorCodes', () => {
		const sdl = `
			"The root of the API." type Query { "Says hello to the caller." hello: String @errors(codes: ["NOPE", "FORBIDDEN"]) }
			"The writes of the API." type Mutation { "Changes the greeting for everyone." set: String }`;
		expect(lint(sdl)).toEqual([]);
		const issues = lint(sdl, { knownErrorCodes: ['FORBIDDEN'] });
		expect(issues.map((i) => [i.coordinate, i.rule])).toEqual([
			['Mutation.set', 'mutation-without-errors'],
			['Query.hello', 'unknown-error-code'],
		]);
	});

	test('every issue says how to fix it', () => {
		const issues = lint('type Query { a: Int }', { knownErrorCodes: [] });
		expect(issues.length).toBeGreaterThan(0);
		for (const issue of issues) {
			expect(issue.fix.length).toBeGreaterThan(10);
			expect(issue.message).toContain(issue.coordinate);
		}
	});

	test('introspection, built-in scalars and directives are skipped', () => {
		const issues = lint('type Query { a: Int }');
		expect(issues.map((i) => i.coordinate)).toEqual(['Query', 'Query.a']);
	});
});
