import { afterEach, describe, expect, test } from 'bun:test';
import { useDepthLimit } from '@envelop/depth-limit';
import { type Booted, boot } from './fixtures.test-util';
import { fromEnvelop } from './from-envelop';

let app: Booted;
afterEach(() => app.stop());

describe('@envelop/depth-limit', () => {
	test('a query deeper than maxDepth is refused with the plugin message', async () => {
		app = boot([fromEnvelop([useDepthLimit({ maxDepth: 2 })])]);
		const answer = await app.gql('{ deep { next { next { value } } } }');
		expect(answer.status).toBe(400);
		expect(answer.type).toContain('application/graphql-response+json');
		expect(answer.json.errors[0].message).toContain(
			'exceeds maximum operation depth of 2',
		);
	});

	test('a query under maxDepth runs', async () => {
		app = boot([fromEnvelop([useDepthLimit({ maxDepth: 10 })])]);
		const answer = await app.gql('{ deep { next { value } } }');
		expect(answer.status).toBe(200);
		expect(answer.json.data.deep.next.value).toBe(2);
	});
});
