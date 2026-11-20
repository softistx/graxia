import { describe, expect, test } from 'bun:test';
import { definePlugin } from '../plugins/define';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from './create-graxia';

const post = (query: string) =>
	new Request('http://localhost/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query }),
	});

type Host = { tenant: string };
const schema = createSchema<Host>()({
	typeDefs: 'type Query { tenant: String }',
	resolvers: { Query: { tenant: (_r, _a, ctx) => ctx.tenant } },
});
const needsTenant = definePlugin<{ tenant: string }>()({
	name: 'needs-tenant',
	onContext: ({ context }) => ({ seen: context.tenant }),
});

describe('createGraxia<Host>()(options)', () => {
	test('returns a working server that takes the host serverContext', async () => {
		const graxia = createGraxia<Host>()({ schema, plugins: [needsTenant] });
		const res = await graxia.fetch(post('{ tenant }'), { tenant: 'acme' });
		expect(await res.json()).toEqual({ data: { tenant: 'acme' } });
		await graxia.dispose();
	});

	test('works with no type argument and the same options as the direct call', async () => {
		const plain = createSchema()({
			typeDefs: 'type Query { hello: String }',
			resolvers: { Query: { hello: () => 'world' } },
		});
		const curried = createGraxia()({ schema: plain });
		const direct = createGraxia({ schema: plain });
		const a = await (await curried.fetch(post('{ hello }'))).json();
		const b = await (await direct.fetch(post('{ hello }'))).json();
		expect(a).toEqual({ data: { hello: 'world' } });
		expect(a).toEqual(b);
		await curried.dispose();
		await direct.dispose();
	});
});
