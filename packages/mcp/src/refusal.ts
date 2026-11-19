/** A JSON-RPC error response with a `fix`: what an MCP client gets when the request never reaches a tool. */
export function refusal(
	status: number,
	message: string,
	fix: string,
	headers: HeadersInit = {},
): Response {
	return Response.json(
		{
			jsonrpc: '2.0',
			error: { code: -32000, message, data: { fix } },
			id: null,
		},
		{ status, headers },
	);
}
