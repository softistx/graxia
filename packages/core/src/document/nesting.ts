const QUOTE = 34;
const BACKSLASH = 92;
const HASH = 35;
const LF = 10;
const CR = 13;

/**
 * The offset of the first bracket that nests `body` deeper than `max` levels
 * (`{`, `(` and `[`), or -1. One linear pass, no recursion. Brackets inside
 * strings, block strings and comments are text; a stray closing bracket is
 * left to the parser.
 */
export function tooDeepAt(body: string, max: number): number {
	let depth = 0;
	const end = body.length;
	for (let i = 0; i < end; i++) {
		const code = body.charCodeAt(i);
		if (code === 123 || code === 40 || code === 91) {
			if (++depth > max) return i;
		} else if (code === 125 || code === 41 || code === 93) {
			if (depth > 0) depth--;
		} else if (code === HASH) {
			while (i + 1 < end) {
				const next = body.charCodeAt(i + 1);
				if (next === LF || next === CR) break;
				i++;
			}
		} else if (code === QUOTE) {
			i = body.startsWith('"""', i)
				? skipBlock(body, i + 3)
				: skipString(body, i + 1);
		}
	}
	return -1;
}

/** Index of the last character of a block string whose content starts at `i`. */
function skipBlock(body: string, start: number): number {
	let i = start;
	while (i < body.length) {
		if (body.startsWith('\\"""', i)) i += 4;
		else if (body.startsWith('"""', i)) break;
		else i++;
	}
	return i + 2;
}

/** Index of the closing quote of a string whose content starts at `i`. */
function skipString(body: string, start: number): number {
	let i = start;
	while (i < body.length) {
		const c = body.charCodeAt(i);
		if (c === BACKSLASH) i += 2;
		else if (c === QUOTE || c === LF || c === CR) break;
		else i++;
	}
	return i;
}
