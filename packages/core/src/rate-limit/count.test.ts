import { describe, expect, test } from 'bun:test';
import { type OperationDefinitionNode, parse } from 'graphql';
import { countFields, selectedOperation } from './count';
import { fieldRateLimit } from './plugin';
import { app, counter, post } from './rate-limit.test-util';

const run = async (query: string, max = 100) => {
	const { limit, calls } = counter(max);
	const graxia = app(
		fieldRateLimit({ fields: { signIn: limit }, key: () => 'k' }),
	);
	const response = await post(graxia, { query });
	return { calls, response };
};

describe('counting selections', () => {
	test('each alias costs one unit', async () => {
		const { calls } = await run('{ a: signIn b: signIn c: signIn }');
		expect(calls).toEqual([{ key: 'signIn:k', cost: 3 }]);
	});

	test('a field at any depth counts, introspection and others do not', async () => {
		const { calls } = await run('{ signIn profile { signIn } hello }');
		expect(calls).toEqual([{ key: 'signIn:k', cost: 2 }]);
	});

	test('inline and named fragments are expanded', async () => {
		const { calls } = await run(
			'{ ... on Query { signIn } ...f } fragment f on Query { x: signIn }',
		);
		expect(calls[0]?.cost).toBe(2);
	});

	test('a fragment spread twice counts twice', async () => {
		const { calls } = await run(
			'{ ...f a: profile { ...g } b: profile { ...g } } fragment f on Query { signIn } fragment g on Profile { signIn }',
		);
		expect(calls[0]?.cost).toBe(3);
	});

	test('exponential fragments stay linear', async () => {
		const depth = 25;
		let query = '{ ...f0 }';
		for (let i = 0; i < depth; i++)
			query += ` fragment f${i} on Query { ...f${i + 1} ...f${i + 1} }`;
		query += ` fragment f${depth} on Query { signIn }`;
		const document = parse(query);
		const operation = selectedOperation(
			document,
			undefined,
		) as OperationDefinitionNode;
		const started = performance.now();
		const counted = countFields(document, operation, new Set(['signIn']));
		expect(performance.now() - started).toBeLessThan(500);
		expect(counted.get('signIn')?.count).toBe(2 ** depth);
	});

	test('only the selected operation counts', async () => {
		const { limit, calls } = counter(100);
		const graxia = app(
			fieldRateLimit({ fields: { signIn: limit }, key: () => 'k' }),
		);
		await post(graxia, {
			query: 'query A { signIn } query B { a: signIn b: signIn }',
			operationName: 'A',
		});
		expect(calls[0]?.cost).toBe(1);
	});

	test('a document without a limited field spends nothing', async () => {
		const { calls } = await run('{ hello }');
		expect(calls).toEqual([]);
	});
});

describe('single', () => {
	const single = (limit = counter(100)) => ({
		...limit,
		graxia: app(
			fieldRateLimit({
				fields: { signIn: { limit: limit.limit, single: true } },
				key: () => 'k',
			}),
		),
	});

	test('two aliases are refused with a 400 and nothing is spent', async () => {
		const { graxia, calls } = single();
		const response = await post(graxia, { query: '{ a: signIn b: signIn }' });
		expect(response.status).toBe(400);
		const body = (await response.json()) as any;
		expect(body.errors[0].message).toBe(
			'signIn may be selected once per operation.',
		);
		expect(body.errors[0].extensions.code).toBe('FIELD_SELECTED_ONCE');
		expect(calls).toEqual([]);
	});

	test('different arguments are different paths', async () => {
		const { graxia } = single();
		const response = await post(graxia, {
			query: '{ signIn(email: "a") profile { signIn(email: "a") } }',
		});
		expect(response.status).toBe(400);
	});

	test('the same field written twice at one path is one path (two units)', async () => {
		const { graxia, calls } = single();
		const response = await post(graxia, { query: '{ signIn signIn }' });
		expect(response.status).toBe(200);
		expect(calls).toEqual([{ key: 'signIn:k', cost: 2 }]);
	});

	test('one selection passes', async () => {
		const { graxia } = single();
		const response = await post(graxia, { query: '{ signIn }' });
		expect(response.status).toBe(200);
	});
});
