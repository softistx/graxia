import { describe, expect, test } from 'bun:test';
import { type ExecutionResult, GraphQLError } from 'graphql';
import { StateBag } from '../plugins/state';
import { createSchema } from '../schema/create-schema';
import { createResultMasker, maskPayload } from './masking';
import { createUnexpectedHandler } from './unexpected';

const schema = createSchema()({ typeDefs: 'type Query { a: String }' });
const leaky = () =>
	new GraphQLError('secret detail', {
		originalError: new Error('secret detail'),
	});

function setup() {
	const reported: unknown[] = [];
	const unexpected = createUnexpectedHandler(
		(error) => void reported.push(error),
	);
	const mask = createResultMasker(undefined, true, schema, unexpected);
	return {
		reported,
		run: (p: object) => maskPayload(mask, p as ExecutionResult, new StateBag()),
	};
}

describe('maskPayload', () => {
	test('graphql17 completed entry errors', () => {
		const { run, reported } = setup();
		const out = JSON.stringify(
			run({ completed: [{ id: '0', errors: [leaky()] }], hasNext: false }),
		);
		expect(out).toContain('Unexpected error.');
		expect(out).not.toContain('secret detail');
		expect(reported).toHaveLength(1);
	});
	test('legacy incremental entry errors', () => {
		const { run, reported } = setup();
		const out = JSON.stringify(
			run({
				incremental: [{ path: ['user'], data: null, errors: [leaky()] }],
				hasNext: false,
			}),
		);
		expect(out).toContain('Unexpected error.');
		expect(out).not.toContain('secret detail');
		expect(reported).toHaveLength(1);
	});
	test('top-level errors of an initial stream result', () => {
		const { run, reported } = setup();
		const out = JSON.stringify(
			run({ data: null, errors: [leaky()], pending: [], hasNext: true }),
		);
		expect(out).toContain('Unexpected error.');
		expect(out).not.toContain('secret detail');
		expect(reported).toHaveLength(1);
	});
});
