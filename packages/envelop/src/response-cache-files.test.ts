import { describe, expect, test } from 'bun:test';
import { useResponseCache } from '@envelop/response-cache';
import { createGraxia, createSchema, GraphQLFile } from '@softistx/graxia';
import { fromEnvelop } from './from-envelop';

const QUERY = 'query Read($f: File) { read(file: $f) }';

function start(options: object) {
	let runs = 0;
	const schema = createSchema()({
		typeDefs: 'scalar File type Query { read(file: File): String }',
		resolvers: {
			File: GraphQLFile,
			Query: {
				read: async (_: unknown, { file }: { file: File }) => {
					runs++;
					return file.text();
				},
			},
		},
	});
	const graxia = createGraxia({
		schema,
		uploads: true,
		plugins: [
			fromEnvelop([useResponseCache({ session: () => null, ...options })]),
		],
	});
	const send = async (content: string) => {
		const body = new FormData();
		body.set(
			'operations',
			JSON.stringify({ query: QUERY, variables: { f: null } }),
		);
		body.set('map', JSON.stringify({ '0': ['variables.f'] }));
		body.set('0', new File([content], 'a.txt'));
		const response = await graxia.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: { accept: 'application/json', 'x-graphql-csrf': '1' },
				body,
			}),
		);
		return ((await response.json()) as any).data.read as string;
	};
	return { send, runs: () => runs };
}

describe('@envelop/response-cache with File variables', () => {
	test('a File serialises as {}: the first answer is served for every file', async () => {
		const app = start({});
		expect(await app.send('one')).toBe('one');
		expect(await app.send('two')).toBe('one');
		expect(app.runs()).toBe(1);
	});

	test('`enabled` excluding the operation runs the resolver for each file', async () => {
		const app = start({ enabled: () => false });
		expect(await app.send('one')).toBe('one');
		expect(await app.send('two')).toBe('two');
		expect(app.runs()).toBe(2);
	});
});
