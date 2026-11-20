import { describe, expect, test } from 'bun:test';
import { definePlugin } from '@graxia/core';
import { parse } from 'graphql';
import { call, mcpFor } from './fixtures.test-util';

describe('what graxia refuses reaches the agent', () => {
	test('graxia limits speak: 2000 root fields is the root-field limit, not a validation abort', async () => {
		const { mcp } = mcpFor({}, { limits: { aliases: false } });
		const query = `{ ${Array.from({ length: 2000 }, (_, i) => `a${i}: books { id }`).join(' ')} }`;
		const r = await call(mcp, 'graphql_query', { query });
		const [error] = r.result.structuredContent.errors;
		expect(error.message).not.toContain('Validation aborted');
		expect(error.message).toContain('root');
		expect(typeof error.extensions.fix).toBe('string');
	});

	test('a document over graxia token limit is graxia parse refusal', async () => {
		const { mcp } = mcpFor({}, { limits: { tokens: 3 } });
		const r = await call(mcp, 'graphql_query', {
			query: '{ books { id title } }',
		});
		const [error] = r.result.structuredContent.errors;
		expect(error.extensions.code).toBe('GRAPHQL_PARSE_FAILED');
		expect(error.message).toContain('tokens');
	});

	test('a document nested past what the parser survives is a parse refusal with core flatten fix', async () => {
		const { mcp } = mcpFor({}, { limits: { nesting: false, tokens: false } });
		const depth = 10000;
		const query = `{ ${'a { '.repeat(depth)}id${' }'.repeat(depth)} }`;
		expect(() => parse(query)).toThrow(RangeError);
		const r = await call(mcp, 'graphql_query', { query });
		const [error] = r.result.structuredContent.errors;
		expect(error.extensions.code).toBe('GRAPHQL_PARSE_FAILED');
		expect(error.extensions.fix).toBe('Flatten the operation.');
	});

	test('a plugin respond keeps its code and fix for the agent', async () => {
		const refuse = (status: number, code: string) =>
			definePlugin({
				name: `refuse-${code}`,
				onRequest: ({ respond }: any) =>
					respond(
						Response.json(
							{
								errors: [
									{
										message: `no ${code}`,
										extensions: { code, fix: `fix ${code}` },
									},
								],
							},
							{ status },
						),
					),
			});
		for (const [status, code] of [
			[401, 'UNAUTHENTICATED'],
			[429, 'RATE_LIMITED'],
		] as const) {
			const { mcp } = mcpFor({}, { plugins: [refuse(status, code)] });
			const r = await call(mcp, 'graphql_query', { query: '{ books { id } }' });
			expect(r.result.isError).toBe(true);
			const [error] = r.result.structuredContent.errors;
			expect(error.extensions).toEqual({ code, fix: `fix ${code}` });
		}
	});

	test('a plugin respond without errors falls back to the generic refusal', async () => {
		const { mcp } = mcpFor(
			{},
			{
				plugins: [
					definePlugin({
						name: 'bare',
						onRequest: ({ respond }: any) =>
							respond(new Response('no', { status: 401 })),
					}),
				],
			},
		);
		const r = await call(mcp, 'graphql_query', { query: '{ books { id } }' });
		const [error] = r.result.structuredContent.errors;
		expect(error.extensions.code).toBe('MCP_EXECUTION_REFUSED');
		expect(error.extensions.fix).toContain('Retry later');
	});

	test('a lenient parser plugin cannot slip a document past the MCP checks', async () => {
		const lenient = definePlugin({
			name: 'lenient',
			onParse: ({ setParseFn }: any) =>
				setParseFn((source: string) =>
					parse(source.startsWith('X') ? source.slice(1) : source),
				),
		});
		const { mcp } = mcpFor(
			{ can: () => () => false },
			{ plugins: [lenient], csrf: false },
		);
		for (const query of [
			'X{ staffReport }',
			'X mutation { rename(id: "1", title: "t") { id } }',
		]) {
			const r = await call(mcp, 'graphql_query', { query });
			const [error] = r.result.structuredContent.errors;
			expect(error.extensions.code).toBe('GRAPHQL_PARSE_FAILED');
			expect(typeof error.extensions.fix).toBe('string');
			expect(JSON.stringify(r.result.structuredContent)).not.toContain(
				'report',
			);
		}
	});
});
