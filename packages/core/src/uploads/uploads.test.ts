import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { definePlugin } from '../plugins/define';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import { GraphQLFile } from './scalar';

let runs = 0;
const schema = createSchema()({
	typeDefs: `scalar File
		type Query { ok: Boolean }
		type Mutation {
			upload(file: File!): String!
			many(files: [File!]!): String!
			deep(input: DeepInput!): String!
		}
		input DeepInput { file: File }
		type Subscription { tick: Int }
	`,
	resolvers: {
		File: GraphQLFile,
		Query: { ok: () => true },
		Mutation: {
			upload: async (_: unknown, { file }: { file: File }) => {
				runs += 1;
				return `${file.name}|${file.type}|${file.size}|${await file.text()}`;
			},
			many: async (_: unknown, args: Record<string, unknown>) => {
				runs += 1;
				return (args['files'] as File[]).map((f) => f.name).join(',');
			},
			deep: (_: unknown, args: Record<string, unknown>) => {
				runs += 1;
				return (args['input'] as { file: File | null }).file?.name ?? 'none';
			},
		},
	},
});
const UPLOAD = 'mutation($f: File!){ upload(file: $f) }';
const CSRF = { 'x-graphql-csrf': '1' };
const headers = definePlugin({
	name: 'headers',
	onRequest({ responseHeaders }) {
		responseHeaders.set('x-plugin', 'kept');
	},
});

const on = createGraxia({
	schema,
	uploads: { bodyBytes: 4096, fileBytes: 1024, files: 3 },
	plugins: [headers],
	onUnexpected: false,
});
const off = createGraxia({ schema, onUnexpected: false });
const batched = createGraxia({
	schema,
	uploads: true,
	batching: { limit: 2 },
	onUnexpected: false,
});
const strict = createGraxia({
	schema,
	uploads: true,
	trustedDocuments: { mode: 'strict', manifest: new Map([['up', UPLOAD]]) },
	onUnexpected: false,
});
afterAll(() => {
	for (const g of [on, off, batched, strict]) void g.dispose();
});
beforeEach(() => {
	runs = 0;
});

interface Sent {
	operations?: unknown;
	map?: unknown;
	files?: Record<string, File>;
	headers?: Record<string, string>;
	accept?: string;
}
const form = (sent: Sent): FormData => {
	const body = new FormData();
	if (sent.operations !== undefined)
		body.set('operations', JSON.stringify(sent.operations));
	if (sent.map !== undefined) body.set('map', JSON.stringify(sent.map));
	for (const [name, file] of Object.entries(sent.files ?? {}))
		body.set(name, file);
	return body;
};
const post = (graxia: typeof on, sent: Sent) =>
	graxia.fetch(
		new Request('http://x/graphql', {
			method: 'POST',
			headers: {
				accept: sent.accept ?? 'application/json',
				...(sent.headers ?? CSRF),
			},
			body: form(sent),
		}),
	);
const single = (name = 'a.txt', content = 'hello'): Sent => ({
	operations: { query: UPLOAD, variables: { f: null } },
	map: { '0': ['variables.f'] },
	files: { '0': new File([content], name, { type: 'image/png' }) },
});
const json = async (response: Response) => (await response.json()) as any;
const errorOf = async (response: Response) =>
	(await json(response)).errors[0] as {
		message: string;
		extensions: { code?: string; fix: string };
	};

describe('uploads: the happy path', () => {
	test('a resolver reads the file name, type, size and content', async () => {
		const response = await post(on, single());
		expect(response.status).toBe(200);
		expect(await json(response)).toEqual({
			data: { upload: 'a.txt|text/plain;charset=utf-8|5|hello' },
		});
	});
	test('one file for two paths, files in a list and nested inputs', async () => {
		const many = await post(on, {
			operations: {
				query: 'mutation($a: [File!]!){ many(files: $a) }',
				variables: { a: [null, null] },
			},
			map: { '0': ['variables.a.0'], '1': ['variables.a.1'] },
			files: { '0': new File(['1'], 'one'), '1': new File(['2'], 'two') },
		});
		expect((await json(many)).data).toEqual({ many: 'one,two' });
		const same = await post(on, {
			operations: {
				query: 'mutation($a: [File!]!){ many(files: $a) }',
				variables: { a: [null, null] },
			},
			map: { '0': ['variables.a.0', 'variables.a.1'] },
			files: { '0': new File(['1'], 'one') },
		});
		expect((await json(same)).data).toEqual({ many: 'one,one' });
		const deep = await post(on, {
			operations: {
				query: 'mutation($i: DeepInput!){ deep(input: $i) }',
				variables: { i: { file: null } },
			},
			map: { '0': ['variables.i.file'] },
			files: { '0': new File(['1'], 'nested') },
		});
		expect((await json(deep)).data).toEqual({ deep: 'nested' });
	});
	test('the answer may be server-sent events', async () => {
		const response = await post(on, {
			...single(),
			accept: 'text/event-stream',
		});
		expect(response.headers.get('content-type')).toContain('text/event-stream');
		expect(await response.text()).toContain(
			'a.txt|text/plain;charset=utf-8|5|hello',
		);
	});
	test('a real server: curl-style multipart over Bun.serve', async () => {
		const server = on.serve({ port: 0 });
		try {
			const response = await fetch(`http://localhost:${server.port}/graphql`, {
				method: 'POST',
				headers: { ...CSRF, accept: 'application/json' },
				body: form(single()),
			});
			expect((await json(response)).data.upload).toContain('a.txt');
		} finally {
			void server.stop(true);
		}
	});
	test('a batch is accepted with batching and refused without', async () => {
		const operations = [
			{ query: UPLOAD, variables: { f: null } },
			{ query: UPLOAD, variables: { f: null } },
		];
		const ok = await post(batched, {
			operations,
			map: { '0': ['0.variables.f'], '1': ['1.variables.f'] },
			files: { '0': new File(['a'], 'a'), '1': new File(['b'], 'b') },
		});
		expect((await json(ok)).map((r: any) => r.data.upload)).toEqual([
			'a||1|a',
			'b||1|b',
		]);
		const refused = await post(strictless(), {
			operations,
			map: { '0': ['0.variables.f'] },
			files: { '0': new File(['a'], 'a') },
		});
		expect(refused.status).toBe(400);
		expect((await errorOf(refused)).message).toBe(
			'Batching is not enabled on this server.',
		);
		expect(runs).toBe(2);
	});
});

function strictless() {
	return createGraxia({ schema, uploads: true, onUnexpected: false });
}

describe('uploads: attackers', () => {
	test('a file over uploads.fileBytes: 413, no resolver', async () => {
		const response = await post(on, single('big', 'x'.repeat(1025)));
		expect(response.status).toBe(413);
		const error = await errorOf(response);
		expect(error.extensions.code).toBe('UPLOAD_TOO_LARGE');
		expect(error.message).toBe(
			'File "0" is larger than uploads.fileBytes (1024 bytes).',
		);
		expect(error.extensions.fix).toContain('uploads.fileBytes');
		expect(runs).toBe(0);
	});
	test('a body over uploads.bodyBytes with an honest Content-Length is refused unread', async () => {
		let pulled = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled += 1;
				controller.enqueue(new Uint8Array(1024));
			},
		});
		const response = await on.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: {
					...CSRF,
					'content-type': 'multipart/form-data; boundary=b',
					'content-length': '999999',
				},
				body: stream,
				duplex: 'half',
			} as RequestInit),
		);
		expect(response.status).toBe(413);
		expect((await errorOf(response)).message).toBe(
			'The request body is larger than uploads.bodyBytes (4096 bytes).',
		);
		expect(pulled).toBeLessThanOrEqual(1);
		expect(runs).toBe(0);
	});
	test('a lying Content-Length: the stream is counted and cancelled', async () => {
		let pulled = 0;
		let cancelled = false;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled += 1;
				controller.enqueue(new Uint8Array(1024));
			},
			cancel() {
				cancelled = true;
			},
		});
		const response = await on.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: {
					...CSRF,
					'content-type': 'multipart/form-data; boundary=b',
					'content-length': '10',
				},
				body: stream,
				duplex: 'half',
			} as RequestInit),
		);
		expect(response.status).toBe(413);
		expect(cancelled).toBe(true);
		// 4096 allowed, counted per chunk: it stops one chunk past the limit (plus the stream's own queue).
		expect(pulled).toBeLessThan(16);
		expect(runs).toBe(0);
	});
	test('more files than uploads.files: 413', async () => {
		const files: Record<string, File> = {};
		const map: Record<string, string[]> = {};
		for (let i = 0; i < 4; i++) {
			files[String(i)] = new File(['x'], `f${i}`);
			map[String(i)] = [`variables.a.${i}`];
		}
		const response = await post(on, {
			operations: {
				query: 'mutation($a: [File!]!){ many(files: $a) }',
				variables: { a: [null, null, null, null] },
			},
			map,
			files,
		});
		expect(response.status).toBe(413);
		const error = await errorOf(response);
		expect(error.extensions.code).toBe('UPLOAD_TOO_MANY_FILES');
		expect(error.message).toBe(
			'The request holds 4 files; uploads.files allows 3.',
		);
		expect(runs).toBe(0);
	});
	test.each([
		['query', 'query'],
		['operationName', 'operationName'],
		['extensions.persistedQuery', 'extensions.persistedQuery'],
	])('a map path outside variables (%s): 400, no resolver', async (_, path) => {
		const sent = single();
		sent.map = { '0': [path] };
		(sent.operations as any).extensions = { persistedQuery: null };
		(sent.operations as any).operationName = null;
		const response = await post(on, sent);
		expect(response.status).toBe(400);
		const error = await errorOf(response);
		expect(error.extensions.code).toBe('UPLOAD_INVALID');
		expect(error.message).toBe(
			`Map entry "0" points at "${path}"; a file may only go under "variables".`,
		);
		expect(runs).toBe(0);
	});
	test('a prototype path is refused and Object.prototype stays clean', async () => {
		const sent = single();
		sent.map = { '0': ['variables.__proto__.polluted'] };
		const response = await post(on, sent);
		expect(response.status).toBe(400);
		expect((await errorOf(response)).message).toBe(
			'Map entry "0" path "variables.__proto__.polluted" is not allowed.',
		);
		expect(({} as any).polluted).toBeUndefined();
		expect(runs).toBe(0);
	});
	test('no CSRF header: 403 before the body is read', async () => {
		let pulled = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled += 1;
				controller.enqueue(new Uint8Array(8));
			},
		});
		const response = await on.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: { 'content-type': 'multipart/form-data; boundary=b' },
				body: stream,
				duplex: 'half',
			} as RequestInit),
		);
		expect(response.status).toBe(403);
		expect((await errorOf(response)).extensions.code).toBe(
			'CSRF_HEADER_REQUIRED',
		);
		expect(pulled).toBeLessThanOrEqual(1);
		expect(runs).toBe(0);
		const form403 = await post(on, { ...single(), headers: {} });
		expect(form403.status).toBe(403);
		expect(runs).toBe(0);
	});
	test('multipart while uploads are off: 415', async () => {
		const response = await post(off, single());
		expect(response.status).toBe(415);
		const error = await errorOf(response);
		expect(error.extensions.code).toBe('UPLOADS_NOT_ENABLED');
		expect(error.message).toBe(
			'File uploads (multipart/form-data) are not enabled on this server.',
		);
		expect(error.extensions.fix).toContain('createGraxia({ uploads: true })');
		expect(runs).toBe(0);
	});
	test('a malformed multipart body: 400', async () => {
		const response = await on.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: { ...CSRF, 'content-type': 'multipart/form-data; boundary=b' },
				body: '--b\r\ngarbage',
			}),
		);
		expect(response.status).toBe(400);
		expect((await errorOf(response)).message).toBe(
			'The multipart body could not be parsed.',
		);
		const noBoundary = await on.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: { ...CSRF, 'content-type': 'multipart/form-data' },
				body: 'x',
			}),
		);
		expect(noBoundary.status).toBe(400);
	});
	test.each([
		[
			{ map: {}, files: {} },
			'The multipart request has no "operations" field.',
		],
		[
			{ operations: { query: '{ ok }' }, files: {} },
			'The multipart request has no "map" field.',
		],
		[
			{ operations: { query: '{ ok }' }, map: [], files: {} },
			'The "map" field must be a JSON object of file field names to arrays of paths.',
		],
		[
			{ ...single(), map: { '0': ['variables.f'], '1': ['variables.f'] } },
			'Map entry "1" has no file part.',
		],
		[{ ...single(), map: {} }, 'File part "0" is not in "map".'],
		[
			{ ...single(), operations: { query: UPLOAD, variables: { f: 'x' } } },
			'Map entry "0" points at "variables.f", which is not null in "operations".',
		],
	])('invalid request %#: 400 UPLOAD_INVALID', async (sent, message) => {
		const response = await post(on, sent as Sent);
		expect(response.status).toBe(400);
		const error = await errorOf(response);
		expect(error.extensions.code).toBe('UPLOAD_INVALID');
		expect(error.message).toBe(message);
		expect(error.extensions.fix).toContain('GraphQL multipart request spec');
		expect(runs).toBe(0);
	});
	test('operations that are not JSON: 400', async () => {
		const body = new FormData();
		body.set('operations', '{nope');
		body.set('map', '{}');
		const response = await on.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: { ...CSRF, accept: 'application/json' },
				body,
			}),
		);
		expect((await errorOf(response)).message).toBe(
			'The "operations" field is not valid JSON.',
		);
	});
	test('operations over limits.bodyBytes: 413, however small the files', async () => {
		const tiny = createGraxia({
			schema,
			uploads: true,
			limits: { bodyBytes: 100 },
			onUnexpected: false,
		});
		const sent = single();
		(sent.operations as any).query = `${UPLOAD} #${'x'.repeat(200)}`;
		const response = await post(tiny, sent);
		expect(response.status).toBe(413);
		const error = await errorOf(response);
		expect(error.message).toBe(
			'The "operations" field is larger than limits.bodyBytes (100 bytes).',
		);
		expect(error.extensions.code).toBe('UPLOAD_TOO_LARGE');
		expect(runs).toBe(0);
		await tiny.dispose();
	});
	test('a JSON request cannot pass a string where a File is due', async () => {
		const response = await on.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json',
				},
				body: JSON.stringify({ query: UPLOAD, variables: { f: 'not-a-file' } }),
			}),
		);
		const body = await json(response);
		expect(body.errors[0].message).toContain(
			'File must be sent as a file part of a multipart request',
		);
		expect(runs).toBe(0);
	});
	test('refusals keep the plugins response headers', async () => {
		const response = await post(on, single('big', 'x'.repeat(2000)));
		expect(response.status).toBe(413);
		expect(response.headers.get('x-plugin')).toBe('kept');
		const notEnabled = createGraxia({
			schema,
			plugins: [headers],
			onUnexpected: false,
		});
		const refused = await post(notEnabled, single());
		expect(refused.status).toBe(415);
		expect(refused.headers.get('x-plugin')).toBe('kept');
		await notEnabled.dispose();
	});
});

describe('uploads and trusted documents', () => {
	test('strict refuses an arbitrary query and runs a documentId', async () => {
		const arbitrary = await post(strict, single());
		expect((await errorOf(arbitrary)).extensions.code).toBe(
			'PERSISTED_QUERY_ONLY',
		);
		expect(runs).toBe(0);
		const sent = single();
		sent.operations = { documentId: 'up', variables: { f: null } };
		const ok = await post(strict, sent);
		expect((await json(ok)).data.upload).toContain('a.txt');
	});
});
