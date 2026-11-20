import type { McpErrorCode } from './codes';

/** A JSON-RPC error response with a `fix`: what an MCP client gets when the request never reaches a tool. */
export function refusal(
	status: number,
	message: string,
	fix: string,
	headers: HeadersInit = {},
	code?: McpErrorCode,
): Response {
	return Response.json(
		{
			jsonrpc: '2.0',
			error: {
				code: -32000,
				message,
				data: code === undefined ? { fix } : { code, fix },
			},
			id: null,
		},
		{ status, headers },
	);
}
