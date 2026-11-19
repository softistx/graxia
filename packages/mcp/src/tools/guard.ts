import type { CallToolResult } from '@modelcontextprotocol/server';
import { textResult } from './result';

/** An unexpected failure goes to `onError` with its cause; the agent gets a generic message, nothing about the server leaks. */
export async function guarded(
	context: { onError: (error: unknown) => void },
	run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
	try {
		return await run();
	} catch (error) {
		context.onError(error);
		return textResult(
			'The server failed to run the operation. Fix: retry later.',
			true,
		);
	}
}
