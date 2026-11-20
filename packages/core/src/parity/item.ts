/**
 * The 33 items of `docs/plan.md` §5 (what `@alxia/graphql` 0.16.4 gives a
 * host) and items 34 and 35 (the status `@alxia/graphql` up to 0.16, on Yoga, answered), each with the specs that prove graxia covers it. `checklist.test.ts`
 * fails when a file is gone, a test title no longer appears in its file, or a
 * divergence has no section in the migration guide: rename a referenced test
 * and this table follows.
 */
export interface ParityItem {
	n: number;
	item: string;
	/** Repository-relative files; `test` is a title the file must contain. */
	specs: readonly { file: string; test?: string }[];
	/** The `##` heading of the migration guide that explains a deliberate difference. */
	differs?: string;
}

export const C = 'packages/core/src/';
export const E = 'examples/host-embedding/src/';
export const core = (file: string, ...tests: string[]) =>
	tests.length === 0
		? [{ file: C + file }]
		: tests.map((test) => ({ file: C + file, test }));
export const at = (file: string, ...tests: string[]) =>
	tests.length === 0 ? [{ file }] : tests.map((test) => ({ file, test }));
