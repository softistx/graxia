import { describe, expect, test } from 'bun:test';
import { PARITY } from './checklist';

const root = new URL('../../../../', import.meta.url);
const GUIDE = 'packages/core/docs/guide/migrating-from-alxia-graphql.md';
const read = (path: string) => Bun.file(new URL(path, root));

describe('parity with @alxia/graphql 0.16.4', () => {
	test('the table has the 33 items of docs/plan.md §5 and items 34 and 35', () => {
		expect(PARITY.map((row) => row.n)).toEqual(
			Array.from({ length: 35 }, (_, i) => i + 1),
		);
		for (const row of PARITY) expect(row.specs.length).toBeGreaterThan(0);
	});

	for (const row of PARITY)
		test(`#${row.n} ${row.item}`, async () => {
			for (const spec of row.specs) {
				const file = read(spec.file);
				expect(await file.exists(), `${spec.file} is gone`).toBe(true);
				if (spec.test)
					expect(
						(await file.text()).includes(spec.test),
						`${spec.file} has no test titled "${spec.test}"`,
					).toBe(true);
			}
			if (row.differs)
				expect(
					(await read(GUIDE).text()).includes(`\n## ${row.differs}\n`),
					`${GUIDE} has no "## ${row.differs}" section`,
				).toBe(true);
		});
});
