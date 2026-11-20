/**
 * What `plugin-index.ts` and `llms.ts` share: the published packages of the
 * workspace and the doc pages each one ships. Pure helpers take text; the
 * readers take a root so a spec can point them at a fixture.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/** Code-point order, the same on every machine (no locale). */
export const byCodePoint = (a: string, b: string): number =>
	a < b ? -1 : a > b ? 1 : 0;

export type Manifest = {
	name: string;
	version: string;
	description?: string;
	private?: boolean;
	exports?: Record<string, unknown>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

export type DocPage = {
	/** Path from the package folder, e.g. `docs/guide/http.md`. */
	file: string;
	/** The page's first `# ` heading, or the file name when it has none. */
	title: string;
	/** The page's markdown. */
	text: string;
};

export type PackageDocs = {
	manifest: Manifest;
	folder: string;
	pages: DocPage[];
};

/** The first level-one heading of a markdown text, outside code fences. */
export function headingOf(text: string): string | undefined {
	let fenced = false;
	for (const line of text.split('\n')) {
		if (/^(```|~~~)/.test(line)) fenced = !fenced;
		else if (!fenced && line.startsWith('# ')) return line.slice(2).trim();
	}
	return undefined;
}

/** A markdown link or image reduced to its text. */
const plain = (text: string): string =>
	text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');

/**
 * The first paragraph under the page's title: the first run of plain lines,
 * skipping frontmatter, headings, quotes, fences, tables, lists and HTML.
 * Links are reduced to their text and the lines joined with a space.
 */
export function firstParagraph(text: string): string {
	const lines = text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
	let fenced = false;
	const run: string[] = [];
	for (const line of lines) {
		if (/^(```|~~~)/.test(line)) {
			fenced = !fenced;
			if (run.length > 0) break;
			continue;
		}
		const skip =
			fenced || /^(#|>|\||\s*[-*+] |\s*\d+\. |<|\s{4}|!\[)/.test(line);
		if (line.trim() === '' || skip) {
			if (run.length > 0) break;
			continue;
		}
		run.push(line.trim());
	}
	return plain(run.join(' ')).replace(/\s+/g, ' ').trim();
}

/**
 * A one-line description: whole sentences while they fit in `max` characters
 * (the first one always, cut at a word and ended with an ellipsis when it
 * alone is longer).
 */
export function describe(paragraph: string, max = 160): string {
	if (paragraph.length <= max) return paragraph;
	// A code span stays whole: its dots and question marks end no sentence.
	const spans: string[] = [];
	const masked = paragraph.replace(/`[^`]*`/g, (span) => {
		spans.push(span);
		return `\uE000${spans.length - 1}\uE000`;
	});
	const unmask = (text: string) =>
		text.replace(/\uE000(\d+)\uE000/g, (_, i) => spans[Number(i)] as string);
	const sentences = masked.split(/(?<=[.!?])\s+/).map(unmask);
	let out = '';
	for (const sentence of sentences) {
		const next = `${out}${out ? ' ' : ''}${sentence.trim()}`;
		if (next.length > max) break;
		out = next;
	}
	if (out) return out;
	const cut = paragraph.slice(0, max - 1);
	return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max - 1).replace(/[\s,;:.]+$/, '')}…`;
}

const mdFiles = (dir: string): string[] =>
	existsSync(dir)
		? readdirSync(dir, { withFileTypes: true })
				.filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
				.map((entry) => entry.name)
				.sort(byCodePoint)
		: [];

/**
 * A package's pages in reading order: the README, the guides, then the
 * troubleshooting pages. The roadmap and the docs index are not listed.
 */
export function pagesOf(root: string, folder: string): DocPage[] {
	const base = join(root, 'packages', folder);
	const files = [
		...(existsSync(join(base, 'README.md')) ? ['README.md'] : []),
		...mdFiles(join(base, 'docs', 'guide')).map((f) => `docs/guide/${f}`),
		...mdFiles(join(base, 'docs'))
			.filter((f) => f.startsWith('troubleshooting'))
			.map((f) => `docs/${f}`),
	];
	return files.map((file) => {
		const text = readFileSync(join(base, file), 'utf8');
		return { file, title: headingOf(text) ?? file, text };
	});
}

/** The published packages (not `"private": true`), sorted by name. */
export function publishedPackages(root = ROOT): PackageDocs[] {
	return readdirSync(join(root, 'packages'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((folder) =>
			existsSync(join(root, 'packages', folder, 'package.json')),
		)
		.map((folder) => ({
			folder,
			manifest: JSON.parse(
				readFileSync(join(root, 'packages', folder, 'package.json'), 'utf8'),
			) as Manifest,
		}))
		.filter(({ manifest }) => manifest.private !== true)
		.sort((a, b) => byCodePoint(a.manifest.name, b.manifest.name))
		.map(({ folder, manifest }) => ({
			folder,
			manifest,
			pages: pagesOf(root, folder),
		}));
}
