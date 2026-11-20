import { afterAll, expect, test } from 'bun:test';
import {
	Client,
	StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { mcpFor } from './fixtures.test-util';
import { manifest } from './operations.test-util';

const { mcp, graxia } = mcpFor({
	mutations: true,
	instructions: 'A library.',
	version: '1.2.3',
});
const server = Bun.serve({
	port: 0,
	routes: { '/mcp': (req) => mcp.fetch(req) },
	fetch: (req) => graxia.fetch(req),
});
afterAll(async () => {
	await server.stop(true);
	await mcp.close();
});

test('a real client: initialize, tools/list, tools/call', async () => {
	const client = new Client({ name: 'test', version: '0.0.0' });
	await client.connect(
		new StreamableHTTPClientTransport(
			new URL(`http://localhost:${server.port}/mcp`),
		),
	);
	expect(client.getServerVersion()?.name).toBe('library');
	expect(client.getServerVersion()?.version).toBe('1.2.3');
	expect(client.getInstructions()).toBe('A library.');
	const { tools } = await client.listTools();
	expect(tools.map((t) => t.name)).toEqual([
		'graphql_schema',
		'graphql_query',
		'graphql_mutate',
	]);
	const schema = await client.callTool({
		name: 'graphql_schema',
		arguments: {},
	});
	expect(JSON.stringify(schema.content)).toContain('Query:');
	const result = await client.callTool({
		name: 'graphql_query',
		arguments: { query: '{ books { title } }' },
	});
	expect(result.structuredContent).toEqual({
		data: { books: [{ title: 'Dune' }] },
	});
	await client.close();
});

test('a real client: a typed tool is listed with its schemas and runs', async () => {
	const typed = mcpFor({ operations: { documents: manifest } });
	const typedServer = Bun.serve({
		port: 0,
		routes: { '/mcp': (req) => typed.mcp.fetch(req) },
		fetch: () => new Response(null, { status: 404 }),
	});
	try {
		const client = new Client({ name: 'test', version: '0.0.0' });
		await client.connect(
			new StreamableHTTPClientTransport(
				new URL(`http://localhost:${typedServer.port}/mcp`),
			),
		);
		const { tools } = await client.listTools();
		const tool = tools.find((t) => t.name === 'book_by_id');
		expect(tool?.title).toBe('BookById');
		expect(tool?.description).toBe('Find a book by its id.');
		expect(tool?.inputSchema).toMatchObject({
			type: 'object',
			properties: { id: { type: 'string', description: 'The book id.' } },
			required: ['id'],
			additionalProperties: false,
		});
		expect(tool?.outputSchema).toMatchObject({
			properties: { data: { type: ['object', 'null'] } },
		});
		// The client validates structuredContent against the advertised output schema.
		const result = await client.callTool({
			name: 'book_by_id',
			arguments: { id: '1' },
		});
		expect(result.structuredContent).toEqual({
			data: { book: { id: '1', title: 'Dune' } },
		});
		const missing = await client.callTool({
			name: 'book_by_id',
			arguments: { id: 'none' },
		});
		expect(missing.structuredContent).toEqual({ data: { book: null } });
		await client.close();
	} finally {
		await typedServer.stop(true);
		await typed.mcp.close();
	}
});
