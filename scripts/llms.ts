#!/usr/bin/env bun
/**
 * `bun run llms` writes `llms.txt` and `llms-full.txt` at the repository root,
 * after the llms.txt convention (llmstxt.org), from the root README's opening
 * and each published package's pages (README, guides, troubleshooting; never
 * the roadmap). `--check` exits 1 when a committed file is stale.
 * `llms.spec.ts` also fails then.
 *
 * `renderLlms` and `renderFull` are pure: they take what `readLlms` collects.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	describe,
	firstParagraph,
	publishedPackages,
	ROOT,
} from './package-docs';

export const BASE_URL = 'https://github.com/softistx/graxia/blob/develop';
export const FILES = ['llms.txt', 'llms-full.txt'] as const;
export const FIX = 'run `bun run llms`';

export type LlmsPage = {
	/** Repository path, e.g. `packages/core/docs/guide/http.md`. */
	path: string;
	title: string;
	text: string;
};
export type LlmsPackage = { name: string; pages: LlmsPage[] };
export type LlmsInput = { summary: string; packages: LlmsPackage[] };

/** `llms.txt`: the title, the summary, one link list per package. */
export function renderLlms({ summary, packages }: LlmsInput): string {
	return [
		'# graxia',
		'',
		`> ${summary}`,
		'',
		...packages.flatMap((pkg) => [
			`## ${pkg.name}`,
			'',
			...pkg.pages.map((page) => {
				const about = describe(firstParagraph(page.text));
				return `- [${page.title}](${BASE_URL}/${page.path})${about ? `: ${about}` : ''}`;
			}),
			'',
		]),
	].join('\n');
}

/** `llms-full.txt`: every page in full under its own separator. */
export function renderFull({ packages }: LlmsInput): string {
	return `${packages
		.flatMap((pkg) =>
			pkg.pages.map((page) =>
				[
					`# ${pkg.name} — ${page.title}`,
					'',
					`Source: ${page.path}`,
					'',
					page.text.trim(),
					'',
				].join('\n'),
			),
		)
		.join('\n')}`;
}

/** The README's opening: its first two paragraphs, as one. */
export function summaryOf(readme: string): string {
	return readme
		.replace(/^# .*\n/, '')
		.split(/\n\s*\n/)
		.map(firstParagraph)
		.filter((paragraph) => paragraph !== '')
		.slice(0, 2)
		.join(' ');
}

export function readLlms(root = ROOT): LlmsInput {
	return {
		summary: summaryOf(readFileSync(join(root, 'README.md'), 'utf8')),
		packages: publishedPackages(root).map(({ folder, manifest, pages }) => ({
			name: manifest.name,
			pages: pages.map((page) => ({
				path: `packages/${folder}/${page.file}`,
				title: page.title,
				text: page.text,
			})),
		})),
	};
}

export const buildLlms = (
	root = ROOT,
): Record<(typeof FILES)[number], string> => {
	const input = readLlms(root);
	return { 'llms.txt': renderLlms(input), 'llms-full.txt': renderFull(input) };
};

if (import.meta.main) {
	const built = buildLlms();
	const stale = FILES.filter(
		(file) =>
			(existsSync(join(ROOT, file))
				? readFileSync(join(ROOT, file), 'utf8')
				: '') !== built[file],
	);
	if (process.argv.includes('--check')) {
		if (stale.length > 0) {
			console.error(`${stale.join(' and ')} stale: ${FIX}`);
			process.exit(1);
		}
		console.log(`${FILES.join(' and ')} are current`);
	} else {
		for (const file of FILES) writeFileSync(join(ROOT, file), built[file]);
		console.log(`wrote ${FILES.join(' and ')}`);
	}
}
