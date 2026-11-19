import type { ExecutionResult } from 'graphql';

/** A small reader of `text/event-stream` responses (graphql-sse, distinct connections mode). */

interface SseEvent {
	event: string;
	data: string;
}

function parseEvent(block: string): SseEvent | undefined {
	let event = 'message';
	const data: string[] = [];
	for (const line of block.split('\n')) {
		if (line.startsWith(':')) continue;
		if (line.startsWith('event:')) event = line.slice(6).trim();
		else if (line.startsWith('data:'))
			data.push(line.slice(5).replace(/^ /, ''));
	}
	return data.length > 0 || event === 'complete'
		? { event, data: data.join('\n') }
		: undefined;
}

/** Yields each `next` payload of one operation sent as a POST; ends on `complete`. */
export async function* sseOperation(
	url: string,
	body: unknown,
	headers: Record<string, string>,
	signal?: AbortSignal,
): AsyncGenerator<ExecutionResult> {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			...headers,
			'content-type': 'application/json',
			accept: 'text/event-stream',
		},
		body: JSON.stringify(body),
		...(signal ? { signal } : {}),
	});
	const type = response.headers.get('content-type') ?? '';
	if (!response.body || !type.includes('text/event-stream')) {
		yield await response.json();
		return;
	}
	const decoder = new TextDecoder();
	let buffer = '';
	for await (const chunk of response.body) {
		buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, '\n');
		let end = buffer.indexOf('\n\n');
		while (end !== -1) {
			const parsed = parseEvent(buffer.slice(0, end));
			buffer = buffer.slice(end + 2);
			if (parsed?.event === 'complete') return;
			if (parsed?.event === 'next') yield JSON.parse(parsed.data);
			end = buffer.indexOf('\n\n');
		}
	}
}
