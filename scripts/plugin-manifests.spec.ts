/**
 * The plugin under plugins/: a valid manifest with no version (plugins follow
 * commits), each skill and agent names itself and says when to use it, and
 * every path SKILL.md names exists. The generated index is checked by
 * `plugin-index.spec.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { publishedPackages } from './package-docs';
import { INDEX_PATH } from './plugin-index';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const PLUGINS = readdirSync(join(ROOT, 'plugins'));

/** The frontmatter as `key: value` pairs (a folded `>-` value joined). */
const frontmatter = (path: string): Record<string, string> => {
	const match = /^---\n([\s\S]*?)\n---\n/.exec(read(path));
	expect(match, `${path} has no frontmatter`).not.toBeNull();
	const fields: Record<string, string> = {};
	let key = '';
	for (const line of (match as RegExpExecArray)[1]?.split('\n') ?? []) {
		const field = /^([a-z-]+):\s*(.*)$/.exec(line);
		if (field) {
			key = field[1] as string;
			fields[key] = (field[2] ?? '').replace(/^>-?$/, '').trim();
		} else if (key) {
			fields[key] = `${fields[key]} ${line.trim()}`.trim();
		}
	}
	return fields;
};

const markdownUnder = (dir: string): string[] =>
	existsSync(join(ROOT, dir))
		? readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
				entry.isDirectory()
					? markdownUnder(`${dir}/${entry.name}`)
					: entry.name.endsWith('.md')
						? [`${dir}/${entry.name}`]
						: [],
			)
		: [];

describe('the manifests', () => {
	test('each plugin.json is named after its folder and has no version', () => {
		for (const name of PLUGINS) {
			const manifest = JSON.parse(
				read(`plugins/${name}/.claude-plugin/plugin.json`),
			);
			expect(manifest.name).toBe(name);
			expect(manifest).not.toHaveProperty('version');
			expect(manifest.description.length).toBeGreaterThan(40);
			expect(manifest.author.name).toBe('softistx');
		}
	});

	test('the repository is not a marketplace', () => {
		expect(existsSync(join(ROOT, '.claude-plugin/marketplace.json'))).toBe(
			false,
		);
	});
});

describe('skills and agents', () => {
	for (const name of PLUGINS) {
		const files = [
			...markdownUnder(`plugins/${name}/agents`),
			...markdownUnder(`plugins/${name}/skills`).filter((file) =>
				file.endsWith('/SKILL.md'),
			),
		];
		test(`${name} has at least one skill and one agent`, () => {
			expect(files.some((f) => f.endsWith('/SKILL.md'))).toBe(true);
			expect(files.some((f) => f.includes('/agents/'))).toBe(true);
		});
		for (const file of files) {
			test(`${file} has a name and a description`, () => {
				const fields = frontmatter(file);
				expect(fields['name']).toMatch(/^[a-z][a-z-]*$/);
				expect(fields['description']?.length).toBeGreaterThan(40);
			});
		}
	}
});

describe('the skill', () => {
	const skillPath = 'plugins/graxia/skills/use-graxia/SKILL.md';

	test('names every published package, and the index is marked generated', () => {
		const skill = read(skillPath);
		for (const { manifest } of publishedPackages(ROOT)) {
			expect(skill, manifest.name).toContain(manifest.name);
		}
		expect(read(INDEX_PATH).startsWith('<!-- GENERATED')).toBe(true);
	});

	test('every published package has an entry in the index', () => {
		const index = read(INDEX_PATH);
		for (const { manifest } of publishedPackages(ROOT)) {
			expect(index).toContain(`## ${manifest.name}\n`);
		}
	});

	test('every node_modules path it names exists in the package', () => {
		const names = [
			...read(skillPath).matchAll(
				/node_modules\/@graxia\/([a-z-]+)\/([\w./-]+?)(?:#[\w-]+)?(?=[`,;:)\s]|\.(?:\s|$))/g,
			),
		];
		expect(names.length).toBeGreaterThan(0);
		for (const [, pkg, rest] of names) {
			const target = (rest as string).replace(/\/$/, '');
			expect(
				existsSync(join(ROOT, 'packages', pkg as string, target)),
				`${pkg}/${target}`,
			).toBe(true);
		}
	});

	test('every #anchor on a named page matches one of its headings', () => {
		const slug = (heading: string) =>
			heading
				.toLowerCase()
				.replace(/[`.]/g, '')
				.replace(/[^\p{L}\p{N}\s-]/gu, '')
				.trim()
				.replace(/\s+/g, '-');
		for (const [, pkg, file, anchor] of read(skillPath).matchAll(
			/node_modules\/@graxia\/([a-z-]+)\/([\w./-]+?\.md)#([\w-]+)/g,
		)) {
			const headings = read(`packages/${pkg}/${file}`)
				.split('\n')
				.filter((l) => /^#{1,6} /.test(l))
				.map((l) => slug(l.replace(/^#+ /, '')));
			expect(headings, `${pkg}/${file}#${anchor}`).toContain(anchor as string);
		}
	});
});
