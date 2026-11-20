/** What the JSON-RPC body of a request asks of the tools. */
export interface ToolCalls {
	/** It holds a `tools/list`. */
	list: boolean;
	/** The names of its `tools/call` messages. */
	called: readonly string[];
}

/**
 * Reads what a request asks of the tools (a message or a batch), from a copy
 * of its body: call it on the admitted request, whose body is in memory. A
 * body that is not JSON asks nothing; the SDK refuses it.
 */
export async function toolCallsOf(request: Request): Promise<ToolCalls> {
	let body: unknown;
	try {
		body = JSON.parse(await request.clone().text());
	} catch {
		return { list: false, called: [] };
	}
	let list = false;
	const called: string[] = [];
	for (const message of Array.isArray(body) ? body : [body]) {
		if (typeof message !== 'object' || message === null) continue;
		const { method, params } = message as {
			method?: unknown;
			params?: { name?: unknown } | null;
		};
		if (method === 'tools/list') list = true;
		if (method === 'tools/call' && typeof params?.name === 'string')
			called.push(params.name);
	}
	return { list, called };
}
