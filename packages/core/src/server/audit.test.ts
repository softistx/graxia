import { afterAll, describe, expect, test } from 'bun:test';
import { serverAudits } from 'graphql-http';
import { createGraxia } from './create-graxia';
import { schema } from './fixtures.test-util';

const server = createGraxia({ schema }).serve({ port: 0 });
afterAll(() => {
	void server.stop(true);
});

describe('graphql-http server audits', () => {
	const audits = serverAudits({
		url: () => `http://localhost:${server.port}/graphql`,
		fetchFn: (input: RequestInfo | URL, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			headers.set('x-graphql-csrf', '1');
			return fetch(input, { ...init, headers });
		},
	});
	for (const audit of audits) {
		test(`${audit.id} ${audit.name}`, async () => {
			const result = await audit.fn();
			expect(result.status).toBe('ok');
		});
	}
});
