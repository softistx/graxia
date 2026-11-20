import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
	BASE_URL,
	buildLlms,
	FILES,
	FIX,
	type LlmsInput,
	renderFull,
	renderLlms,
	summaryOf,
} from './llms';
import { describe as cut, firstParagraph, headingOf } from './package-docs';

const input: LlmsInput = {
	summary: 'A summary.',
	packages: [
		{
			name: '@x/b',
			pages: [
				{
					path: 'packages/b/README.md',
					title: '@x/b',
					text: '# @x/b\n\nB does things. More text.\n',
				},
			],
		},
		{ name: '@x/empty', pages: [] },
	],
};

describe('the page helpers', () => {
	test('headingOf skips code fences', () => {
		expect(headingOf('```\n# no\n```\n# yes\n')).toBe('yes');
	});

	test('firstParagraph skips headings, tables, lists and fences, and strips links', () => {
		const text =
			'---\na: b\n---\n# T\n\n> note\n\n| a |\n\n- item\n\nSee [the guide](./g.md) now,\nthen go.\n\nSecond.';
		expect(firstParagraph(text)).toBe('See the guide now, then go.');
	});

	test('describe keeps short text, cuts at a sentence end under 160', () => {
		expect(cut('Short one.')).toBe('Short one.');
		const long = `${'First sentence here. '.repeat(3)}${'x'.repeat(200)}.`;
		expect(cut(long)).toBe(
			'First sentence here. First sentence here. First sentence here.',
		);
	});

	test('describe never splits inside a code span or a version number', () => {
		const text = `Uses \`extensions.fix\` and 0.5 of the engine. ${'y '.repeat(100)}`;
		expect(cut(text)).toBe('Uses `extensions.fix` and 0.5 of the engine.');
	});

	test('describe cuts one over-long sentence at a word with an ellipsis', () => {
		const out = cut(`${'word '.repeat(60)}end.`);
		expect(out.length).toBeLessThanOrEqual(160);
		expect(out.endsWith('…')).toBe(true);
	});
});

describe('renderLlms', () => {
	const out = renderLlms(input);

	test('has the title, the summary and a link list per package', () => {
		expect(out.startsWith('# graxia\n\n> A summary.\n')).toBe(true);
		expect(out).toContain(
			`- [@x/b](${BASE_URL}/packages/b/README.md): B does things. More text.`,
		);
	});

	test('a package without docs gets an empty section, in order', () => {
		expect(out).toContain('## @x/empty\n');
		expect(out.indexOf('## @x/b')).toBeLessThan(out.indexOf('## @x/empty'));
	});

	test('is deterministic', () => {
		expect(renderLlms(input)).toBe(out);
	});
});

describe('renderFull', () => {
	test('puts each page in full under a package separator with its source', () => {
		const out = renderFull(input);
		expect(out).toContain(
			'# @x/b — @x/b\n\nSource: packages/b/README.md\n\n# @x/b\n\nB does things. More text.',
		);
	});
});

describe('summaryOf', () => {
	test('joins the first two paragraphs after the title', () => {
		expect(summaryOf('# t\n\nOne\nline.\n\nTwo.\n\nThree.\n')).toBe(
			'One line. Two.',
		);
	});
});

describe('the committed files', () => {
	const built = buildLlms();
	for (const file of FILES) {
		test(`${file} equals what llms.ts generates now (${FIX})`, async () => {
			const committed = await Bun.file(
				join(import.meta.dir, '..', file),
			).text();
			expect(committed, `${file} is stale: ${FIX}`).toBe(built[file]);
		});
	}
});
