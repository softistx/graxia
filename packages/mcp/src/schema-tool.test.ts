import { describe, expect, test } from 'bun:test';
import { call, mcpFor } from './fixtures.test-util';

const text = (r: { result: { content: { text: string }[] } }) =>
	r.result.content[0]?.text ?? '';

describe('graphql_schema', () => {
	test('no input: operations and type names, no Mutation unless enabled', async () => {
		const { mcp } = mcpFor();
		const out = text(await call(mcp, 'graphql_schema', {}));
		expect(out).toContain('Query:');
		expect(out).toContain('book(id: ID!): Book — Find a book by id.');
		expect(out).not.toContain('Mutation:');
		expect(out).toContain('Types: Book, Query, Subscription');
		expect(out).toContain('Next: call graphql_schema');
	});

	test('no input with mutations: lists the Mutation fields', async () => {
		const { mcp } = mcpFor({ mutations: true });
		expect(text(await call(mcp, 'graphql_schema', {}))).toContain(
			'Mutation:\n  rename(id: ID!, title: String!): Book — Rename a book.',
		);
	});

	test('the Mutation root is not offered unless mutations are enabled', async () => {
		const { mcp } = mcpFor();
		const asked = await call(mcp, 'graphql_schema', { types: ['Mutation'] });
		expect(asked.result.isError).toBe(true);
		expect(text(asked)).toContain('# Unknown type Mutation. Fix:');
		expect(text(asked)).not.toContain('rename');
		const found = await call(mcp, 'graphql_schema', { search: 'rename' });
		expect(found.result.isError).toBe(true);
		const { mcp: on } = mcpFor({ mutations: true });
		expect(
			text(await call(on, 'graphql_schema', { types: ['Mutation'] })),
		).toContain('rename');
	});

	test('types: more names than the search limit is refused by the input schema', async () => {
		const { mcp } = mcpFor();
		const r = await call(mcp, 'graphql_schema', {
			types: Array.from({ length: 51 }, (_, i) => `T${i}`),
		});
		expect(r.result?.isError ?? r.body.error).toBeTruthy();
	});

	test('types: SDL with descriptions and applied @needs, directive declared', async () => {
		const { mcp } = mcpFor();
		const out = text(await call(mcp, 'graphql_schema', { types: ['Book'] }));
		expect(out).toContain('"A book in the library."');
		expect(out).toContain('type Book');
		expect(out).toContain('@needs(permission: "staff")');
		expect(out).toContain('directive @needs');
		expect(out).not.toContain('type Query');
	});

	test('types: an unknown name is listed with a fix', async () => {
		const { mcp } = mcpFor();
		const r = await call(mcp, 'graphql_schema', { types: ['Book', 'Nope'] });
		expect(text(r)).toContain('# Unknown type Nope. Fix:');
		expect(text(r)).toContain('type Book');
		expect(r.result.isError).toBeUndefined();
		const none = await call(mcp, 'graphql_schema', { types: ['Nope'] });
		expect(none.result.isError).toBe(true);
	});

	test('search: matches names and descriptions, case-insensitive', async () => {
		const { mcp } = mcpFor();
		const byName = text(await call(mcp, 'graphql_schema', { search: 'BOOK' }));
		expect(byName).toContain('type Book');
		const byDescription = text(
			await call(mcp, 'graphql_schema', { search: 'title' }),
		);
		expect(byDescription).toContain('type Book');
		const none = await call(mcp, 'graphql_schema', { search: 'zebra' });
		expect(none.result.isError).toBe(true);
		expect(text(none)).toContain('Fix:');
	});

	test('search: output is capped with a fix', async () => {
		const { SEARCH_LIMIT } = await import('./tools/schema');
		expect(SEARCH_LIMIT).toBe(50);
	});

	test('the caller view hides what @needs hides, and `can` may be async', async () => {
		const seen: string[] = [];
		const { mcp } = mcpFor({
			can: async (request) => {
				seen.push(request.method);
				return (p) => p === 'staff' && request.headers.has('x-staff');
			},
		});
		const hidden = text(await call(mcp, 'graphql_schema', { types: ['Book'] }));
		expect(hidden).not.toContain('secretNote');
		const shown = text(
			await call(
				mcp,
				'graphql_schema',
				{ types: ['Book'] },
				{ 'x-staff': '1' },
			),
		);
		expect(shown).toContain('secretNote');
		expect(seen.length).toBe(2);
	});
});
