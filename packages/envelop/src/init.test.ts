import { afterEach, describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '@graxia/core';
import { type Booted, boot } from './fixtures.test-util';
import { fromEnvelop } from './from-envelop';

let app: Booted;
afterEach(() => app?.stop());

describe('onPluginInit', () => {
	test('addPlugin inserts after the adder, recursively', async () => {
		const order: string[] = [];
		const leaf = { onExecute: () => void order.push('leaf') };
		const mid = {
			onPluginInit: ({ addPlugin }: any) => addPlugin(leaf),
			onExecute: () => void order.push('mid'),
		};
		const root = {
			onPluginInit: ({ addPlugin }: any) => addPlugin(mid),
			onExecute: () => void order.push('root'),
		};
		app = boot([
			fromEnvelop([root, { onExecute: () => void order.push('last') }]),
		]);
		await app.gql('{ hello }');
		expect(order).toEqual(['root', 'mid', 'leaf', 'last']);
	});

	test('setSchema is refused at fromEnvelop()', () => {
		expect(() =>
			fromEnvelop([{ onPluginInit: ({ setSchema }: any) => setSchema({}) }]),
		).toThrow(GraxiaConfigError);
	});
});

describe('onSchemaChange', () => {
	test('is called once with the schema, at setup', async () => {
		const seen: unknown[] = [];
		app = boot([
			fromEnvelop([
				{ onSchemaChange: ({ schema }: any) => void seen.push(schema) },
			]),
		]);
		await app.graxia.ready;
		expect(seen).toHaveLength(1);
		expect(seen[0]).toBe(app.graxia.schema);
	});

	test('replaceSchema fails the setup with the alternative', async () => {
		app = boot([
			fromEnvelop([
				{ onSchemaChange: ({ replaceSchema }: any) => replaceSchema({}) },
			]),
		]);
		await expect(app.graxia.ready).rejects.toThrow(
			'replaceSchema, which graxia does not honour',
		);
	});
});
