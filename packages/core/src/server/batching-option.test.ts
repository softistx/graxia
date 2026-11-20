import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '../errors/config-error';
import { createGraxia } from './create-graxia';
import { schema } from './fixtures.test-util';

const send = (batching: unknown, count: number) =>
	createGraxia({ schema, batching: batching as never }).fetch(
		new Request('http://x/graphql', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(Array(count).fill({ query: '{ hello }' })),
		}),
	);

describe('batching: true', () => {
	test('accepts up to 10 operations', async () => {
		const res = await send(true, 10);
		expect(res.status).toBe(200);
		expect(await res.json()).toHaveLength(10);
	});
	test('refuses 11 with the over-limit error', async () => {
		const res = await send(true, 11);
		expect(res.status).toBe(400);
		expect(await res.text()).toContain('A batch holds at most 10 operations');
	});
	test('false stays off', async () => {
		expect((await send(false, 1)).status).toBe(400);
	});
});

describe('batching: a bad value', () => {
	for (const bad of [0, 1.5, 'yes', null, { limit: 0 }, {}])
		test(`${JSON.stringify(bad)} names the accepted forms`, () => {
			expect(() => send(bad, 1)).toThrow(GraxiaConfigError);
			expect(() => send(bad, 1)).toThrow(
				'batching must be true, false or { limit: <positive integer> }',
			);
		});
});
