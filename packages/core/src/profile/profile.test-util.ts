import { fieldRateLimit } from '../rate-limit/plugin';
import { memoryFieldLimit } from '../rate-limit/store';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';

export const schema = createSchema()({
	typeDefs: `
		type Query { hello: String boom: String signIn: Boolean nodes: [Node!]! me: Node }
		type Node { id: ID! children: [Node!]! me: Node }
	`,
	resolvers: {
		Query: {
			hello: () => 'world',
			boom: () => {
				throw new Error('secret detail');
			},
			signIn: () => true,
			nodes: () => [],
			me: () => ({ id: '1' }),
		},
		Node: { children: () => [], me: () => ({ id: '1' }) },
	},
});

const deep = (levels: number) =>
	`{ me ${'{ me '.repeat(levels - 1)}{ id }${' }'.repeat(levels - 1)} }`;
const aliases = (n: number) =>
	`{ ${Array.from({ length: n }, (_, i) => `a${i}: hello`).join(' ')} }`;
const tokens = (n: number) =>
	`{ ${Array.from({ length: n }, () => 'hello').join(' ')} }`;

/** The manifest a client toolchain would build: every document the profile specs may send by id. */
export const manifest = {
	hello: '{ hello }',
	boom: '{ boom }',
	typo: '{ helo }',
	signIn: '{ signIn }',
	schema: '{ __schema { queryType { name } } }',
	type: '{ __type(name: "Query") { name } }',
	typename: '{ __typename }',
	deep: deep(13),
	aliases: aliases(31),
	cost: '{ nodes { children { children { children { children { id } } } } } }',
	tokens: tokens(15_001),
};

export type Reported = { error: unknown; phase: string }[];

/** Builds the instance with `NODE_ENV` set around `createGraxia` (read once there), then restores it. */
export function build(env: string | undefined, reported: Reported = []) {
	const previous = process.env['NODE_ENV'];
	if (env === undefined) delete process.env['NODE_ENV'];
	else process.env['NODE_ENV'] = env;
	try {
		return createGraxia({
			schema,
			context: () => ({ ip: '203.0.113.7' }),
			trustedDocuments: { manifest },
			plugins: [
				fieldRateLimit({
					fields: {
						signIn: memoryFieldLimit({ limit: 1, windowMs: 60_000 }),
					},
				}),
			],
			onUnexpected: (error, info) =>
				reported.push({ error, phase: info.phase }),
		});
	} finally {
		if (previous === undefined) delete process.env['NODE_ENV'];
		else process.env['NODE_ENV'] = previous;
	}
}

export type Body = {
	data?: Record<string, unknown> | null;
	errors?: { message: string; extensions?: Record<string, any> }[];
};

type Graxia = ReturnType<typeof build>;

/** POST a JSON operation (the CSRF-safe shape). */
export function post(graxia: Graxia, body: unknown, headers: HeadersInit = {}) {
	return graxia.fetch(
		new Request('http://app.test/graphql', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json',
				...headers,
			},
			body: typeof body === 'string' ? body : JSON.stringify(body),
		}),
	);
}

/** Runs a manifest document by id and returns the status and body. */
export async function byId(graxia: Graxia, id: keyof typeof manifest) {
	const response = await post(graxia, { documentId: id });
	return { response, body: (await response.json()) as Body };
}

export const codes = (body: Body) =>
	body.errors?.map((e) => e.extensions?.['code']);
