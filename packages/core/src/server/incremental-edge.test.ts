import { describe, expect, test } from 'bun:test';
import { definePlugin } from '../plugins/define';
import { DEFER, MULTIPART, make, parts, post } from './incremental.test-util';

let returned = 0;

describe('hooks, masking and context', () => {
	test('onResultChunk sees and replaces a subsequent payload', async () => {
		const seen: unknown[] = [];
		const g = make({
			plugins: [
				definePlugin()({
					name: 'p',
					onResultChunk: ({ chunk, setChunk }) => {
						seen.push(chunk);
						const c = chunk as { incremental?: unknown };
						if (c.incremental) setChunk({ ...c, marked: true });
					},
				}),
			],
		});
		const payloads = await parts(await g.fetch(post(DEFER, MULTIPART)));
		expect(seen).toHaveLength(2);
		expect(payloads[1].marked).toBe(true);
	});

	test('a thrown deferred resolver error is masked and reported once', async () => {
		const reported: unknown[] = [];
		const g = make({ onUnexpected: (e) => void reported.push(e) });
		const payloads = await parts(
			await g.fetch(
				post('{ user { name ... @defer { bad } } }', MULTIPART, {
					'x-request-id': 'rid-1',
				}),
			),
		);
		const text = JSON.stringify(payloads);
		expect(text).toContain('Unexpected error.');
		expect(text).not.toContain('secret detail');
		expect(text).toContain('INTERNAL_SERVER_ERROR');
		expect(reported).toHaveLength(1);
	});

	test('getContext works in a deferred resolver', async () => {
		const g = make({ context: () => ({ user: 'ada' }) });
		const payloads = await parts(
			await g.fetch(post('{ user { ... @defer { who } } }', MULTIPART)),
		);
		expect(JSON.stringify(payloads)).toContain('"who":"ada"');
	});
});

describe('cancellation and shutdown', () => {
	const hang = '{ hello ... @defer { never { value } } }';

	test('client abort ends the stream and calls return()', async () => {
		returned = 0;
		const g = make({
			plugins: [
				definePlugin()({
					name: 'spy',
					onExecute: ({ setExecuteFn }) =>
						setExecuteFn(async (args) => {
							const { experimentalExecuteIncrementally } = await import(
								'graphql'
							);
							const out = (await experimentalExecuteIncrementally(args)) as any;
							const inner = out.subsequentResults;
							const origReturn = inner.return.bind(inner);
							inner.return = (...a: unknown[]) => {
								returned++;
								return origReturn(...a);
							};
							return out;
						}),
				}),
			],
		});
		const ac = new AbortController();
		const response = await g.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: MULTIPART },
				body: JSON.stringify({ query: hang }),
				signal: ac.signal,
			}),
		);
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		await reader.read();
		ac.abort();
		await reader.cancel().catch(() => {});
		await g.dispose({ timeout: 500 });
		expect(returned).toBeGreaterThan(0);
	});

	test('dispose waits for a deferred part that finishes within shutdownTimeout', async () => {
		const g = make();
		const response = await g.fetch(
			post('{ user { name ... @defer { slow } } }', MULTIPART),
		);
		const disposing = g.dispose({ timeout: 2000 });
		const payloads = await parts(response);
		await disposing;
		expect(JSON.stringify(payloads)).toContain('"slow":"late"');
	});

	test('dispose cuts an incremental stream that outlives shutdownTimeout, and closes it', async () => {
		const g = make();
		const response = await g.fetch(post(hang, MULTIPART));
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		await reader.read();
		const started = Date.now();
		await g.dispose({ timeout: 300 });
		const waited = Date.now() - started;
		expect(waited).toBeGreaterThanOrEqual(250);
		expect(waited).toBeLessThan(2000);
		let text = '';
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			text += new TextDecoder().decode(value);
		}
		expect(text.endsWith('\r\n-----\r\n')).toBe(true);
	});
});
