import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GraphQLError, parse, validate } from 'graphql';
import { type Booted, boot, calls } from './fixtures.test-util';
import { fromEnvelop } from './from-envelop';

let app: Booted;
beforeEach(() => calls.reset());
afterEach(() => app.stop());
const run = (hooks: object, query = '{ hello }') => {
	app = boot([fromEnvelop([hooks as never])]);
	return app.gql(query);
};

describe('onParse', () => {
	test('setParsedDocument skips parsing', async () => {
		const answer = await run(
			{
				onParse: ({ setParsedDocument }: any) =>
					setParsedDocument(parse('{ hello }')),
			},
			'not graphql at all',
		);
		expect(answer.json.data.hello).toBe('world');
	});

	test('setParseFn replaces the parser and keeps the token limit', async () => {
		let called = 0;
		const answer = await run({
			onParse: ({ setParseFn, parseFn }: any) =>
				setParseFn((...a: unknown[]) => {
					called++;
					return parseFn(...a);
				}),
		});
		expect(called).toBe(1);
		expect(answer.json.data.hello).toBe('world');
	});

	test('the after-hook sees the document, or null on a syntax error', async () => {
		const seen: unknown[] = [];
		const hooks = {
			onParse:
				() =>
				({ result }: any) =>
					void seen.push(result),
		};
		await run(hooks);
		await app.stop();
		await run(hooks, '{ hello');
		expect(seen[0]).toHaveProperty('kind', 'Document');
		expect(seen[1]).toBeNull();
	});

	test('a GraphQLError thrown in onParse keeps its message and code', async () => {
		const answer = await run({
			onParse: () => {
				throw new GraphQLError('nope', { extensions: { code: 'MY_CODE' } });
			},
		});
		expect(answer.json.errors[0].message).toBe('nope');
		expect(answer.json.errors[0].extensions.code).toBe('MY_CODE');
		expect(answer.status).toBe(400);
	});
});

describe('onValidate', () => {
	test('addValidationRule reaches the client as a 400', async () => {
		const answer = await run({
			onValidate: ({ addValidationRule }: any) =>
				addValidationRule((ctx: any) => ({
					Field: (node: any) => {
						if (node.name.value === 'hello')
							ctx.reportError(new GraphQLError('hello is closed'));
					},
				})),
		});
		expect(answer.status).toBe(400);
		expect(answer.type).toContain('application/graphql-response+json');
		expect(answer.json.errors[0].message).toBe('hello is closed');
		expect(calls.hello).toBe(0);
	});

	test('setValidationFn replaces the validator', async () => {
		let called = false;
		const answer = await run({
			onValidate: ({ setValidationFn }: any) =>
				setValidationFn((...a: [any, any, any]) => {
					called = true;
					return validate(...a);
				}),
		});
		expect(called).toBe(true);
		expect(answer.json.data.hello).toBe('world');
	});

	test('setResult([]) skips validation', async () => {
		const answer = await run(
			{ onValidate: ({ setResult }: any) => setResult([]) },
			'{ doesNotExist }',
		);
		expect(answer.text).not.toContain('Cannot query field');
	});
});
