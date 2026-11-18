import { expect, test } from 'bun:test';
import { tooDeepAt } from './nesting';

test('tooDeepAt returns the offset of the bracket past the limit', () => {
	expect(tooDeepAt('{{{}}}', 3)).toBe(-1);
	expect(tooDeepAt('{{{{}}}}', 3)).toBe(3);
	expect(tooDeepAt('"{{{{{" # {{{{\n{', 1)).toBe(-1);
});

test('an escaped quote does not end a string', () => {
	expect(tooDeepAt('{ a(x: "\\" {{{{") }', 2)).toBe(-1);
	expect(tooDeepAt('{ a(x: "\\\\") {{{ }', 2)).toBeGreaterThan(0);
});
