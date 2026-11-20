import { afterEach, describe, expect, test } from 'bun:test';
import { useGenericAuth } from '@envelop/generic-auth';
import { createSchema } from '@softistx/graxia';
import { type Booted, boot, typeDefs } from './fixtures.test-util';
import { fromEnvelop } from './from-envelop';

interface User {
	id: string;
}
let app: Booted;
afterEach(() => app.stop());

const resolveUserFn = (context: { request: Request }): User | null => {
	const token = context.request.headers.get('authorization');
	return token ? { id: token } : null;
};

describe('@envelop/generic-auth', () => {
	test('protect-all refuses an anonymous request and lets a user through', async () => {
		app = boot([
			fromEnvelop([useGenericAuth({ mode: 'protect-all', resolveUserFn })]),
		]);
		const anonymous = await app.gql('{ hello }');
		expect(anonymous.json.errors[0].message).toContain('Unauthorized');
		expect(anonymous.json.errors[0].extensions.code).toBe(
			'UNAUTHORIZED_FIELD_OR_TYPE',
		);
		const user = await app.gql('{ hello }', {
			headers: { authorization: 'u1' },
		});
		expect(user.json.data.hello).toBe('world');
	});

	test('the user reaches the resolvers as context.currentUser, typed by Added', async () => {
		const schema = createSchema<{ currentUser: User }>()({
			typeDefs,
			resolvers: {
				Query: { hello: (_p: unknown, _a: unknown, ctx) => ctx.currentUser.id },
			},
		});
		app = boot(
			[
				fromEnvelop<{ currentUser: User }>([
					useGenericAuth({ mode: 'resolve-only', resolveUserFn }),
				]),
			],
			{ schema },
		);
		const answer = await app.gql('{ hello }', {
			headers: { authorization: 'u7' },
		});
		expect(answer.json.data.hello).toBe('u7');
	});

	test('protect-granular keeps fields open unless @authenticated', async () => {
		const schema = createSchema()({
			typeDefs: `directive @authenticated on FIELD_DEFINITION
				type Query { open: String secret: String @authenticated }`,
			resolvers: { Query: { open: () => 'o', secret: () => 's' } },
		});
		app = boot(
			[
				fromEnvelop([
					useGenericAuth({ mode: 'protect-granular', resolveUserFn }),
				]),
			],
			{ schema },
		);
		const open = await app.gql('{ open }');
		expect(open.json.data.open).toBe('o');
		const secret = await app.gql('{ secret }');
		expect(secret.json.errors[0].message).toContain('Unauthorized');
	});

	test('@policy fails closed: a policy-protected field is denied', async () => {
		const schema = createSchema()({
			typeDefs: `directive @policy(policies: [String!]!) on FIELD_DEFINITION
				type Query { open: String secret: String @policy(policies: ["admin"]) }`,
			resolvers: { Query: { open: () => 'o', secret: () => 's' } },
		});
		app = boot(
			[
				fromEnvelop([
					useGenericAuth({
						mode: 'protect-granular',
						resolveUserFn,
						extractPolicies: () => ['admin'],
					}),
				]),
			],
			{ schema },
		);
		const open = await app.gql('{ open }');
		expect(open.json.data.open).toBe('o');
		const secret = await app.gql('{ secret }', {
			headers: { authorization: 'u1' },
		});
		expect(secret.json.data?.secret ?? null).toBeNull();
		expect(secret.json.errors).toBeDefined();
	});
});
