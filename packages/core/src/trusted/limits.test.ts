import { describe, expect, test } from 'bun:test';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import { createTestClient } from '../testing/client';

const schema = createSchema()({
	typeDefs: `
		type Query { n: Node }
		type Node { id: ID next: Node }
	`,
	resolvers: { Query: { n: () => ({ id: '1' }) } },
});

const DEEP = '{ n { next { next { id } } } }';

describe('limits apply to trusted documents', () => {
	test('a manifest document over the depth limit is refused', async () => {
		const graxia = createGraxia({
			schema,
			onUnexpected: false,
			limits: { depth: 3 },
			trustedDocuments: { manifest: { deep: DEEP }, mode: 'strict' },
		});
		const result = await createTestClient(graxia).query(null, {
			documentId: 'deep',
		});
		expect(result.data).toBeUndefined();
		expect(result.errors?.[0]?.message).toContain('depth');
		await graxia.dispose({ timeout: 10 });
	});

	test('a manifest document over the cost limit is refused', async () => {
		const graxia = createGraxia({
			schema,
			onUnexpected: false,
			limits: { cost: { max: 2 } },
			trustedDocuments: { manifest: { deep: DEEP }, mode: 'strict' },
		});
		const result = await createTestClient(graxia).query(null, {
			documentId: 'deep',
		});
		expect(result.data).toBeUndefined();
		expect(result.errors?.[0]?.message).toContain('cost');
		await graxia.dispose({ timeout: 10 });
	});
});
