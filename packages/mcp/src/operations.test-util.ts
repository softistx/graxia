import type { TrustedManifest } from '@softistx/graxia';

/** A codegen-style manifest (`persisted-documents.json`) over the library fixture. */
export const manifest = {
	a1: '"""Find a book by its id.""" query BookById("""The book id.""" $id: ID!) { book(id: $id) { id title } }',
	a2: '"""All the books.""" query Books { books { id title } }',
	a3: '"""Rename a book.""" mutation RenameBook($id: ID!, $title: String!) { rename(id: $id, title: $title) { id title } }',
	a4: '"""The staff report.""" query StaffReport { staffReport }',
	a5: 'subscription Ticks { ticks }',
} satisfies TrustedManifest;

/** The same documents as an Apollo persisted query manifest. */
export const apollo: TrustedManifest = {
	format: 'apollo-persisted-query-manifest',
	version: 1,
	operations: Object.entries(manifest).map(([id, body]) => ({ id, body })),
};

/** The same documents as a `Map`. */
export const asMap: TrustedManifest = new Map(Object.entries(manifest));

/** The tools of a `tools/list` answer. */
export async function listed(
	mcp: { fetch(r: Request): Promise<Response> },
	request: Request,
): Promise<any[]> {
	const text = await (await mcp.fetch(request)).text();
	const body = JSON.parse(
		text.startsWith('event:') || text.startsWith('data:')
			? (text.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5)
			: text,
	);
	return body.result.tools;
}
