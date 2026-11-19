import { describe, expect, test } from 'bun:test';
import { definePlugin } from '@graxia/core';
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
});
