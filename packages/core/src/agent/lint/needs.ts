import type { LintIssue } from './types';

export const invalidNeeds = (coordinate: string): LintIssue => ({
	coordinate,
	rule: 'invalid-needs',
	message: `@needs on ${coordinate} gives both permission and anyOf, or neither (or an empty anyOf).`,
	fix: 'Give @needs exactly one of permission: "x" or anyOf: ["x", "y"]; repeat @needs to require several.',
});
