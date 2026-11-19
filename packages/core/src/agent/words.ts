/** Words that carry no meaning in a description of a name. */
const FILLER = new Set([
	'a',
	'an',
	'the',
	'of',
	'for',
	'this',
	'that',
	'is',
	'are',
	'field',
	'value',
	'type',
	'argument',
	'input',
]);

/** The lower-case words of a name or sentence: camelCase, snake_case and punctuation split. */
export function wordsOf(text: string): string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word !== '');
}

const stem = (word: string): string =>
	word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;

/**
 * Whether `description` only says the name again, in other words: `The id.`
 * on `id`, `The book title` on `bookTitle`. Filler words and plurals do not count.
 */
export function restatesName(name: string, description: string): boolean {
	const named = new Set(wordsOf(name).map(stem));
	const said = wordsOf(description)
		.filter((word) => !FILLER.has(word))
		.map(stem);
	return said.length > 0 && said.every((word) => named.has(word));
}
