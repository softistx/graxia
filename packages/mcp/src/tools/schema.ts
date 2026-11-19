import {
	type GraphQLNamedType,
	type GraphQLObjectType,
	isEnumType,
	isInputObjectType,
	isInterfaceType,
	isObjectType,
} from 'graphql';
import { directivesUsedBy, type View } from '../view';
import { textResult } from './result';

/** The most types one `search` returns; the answer says when more matched. */
export const SEARCH_LIMIT = 50;

const firstLine = (text: string | null | undefined): string =>
	text ? ` — ${text.trim().split('\n')[0]}` : '';

function rootBlock(
	label: string,
	type: GraphQLObjectType | undefined,
): string[] {
	if (!type) return [];
	const lines = Object.values(type.getFields())
		.filter((field) => field.name !== '_empty')
		.map((field) => {
			const args = field.args.map((a) => `${a.name}: ${a.type}`).join(', ');
			return `  ${field.name}${args ? `(${args})` : ''}: ${field.type}${firstLine(field.description)}`;
		});
	return lines.length > 0 ? [`${label}:`, ...lines, ''] : [];
}

/** No input: what the caller can do, and the type names to ask about. */
export function overview(view: View, mutations: boolean) {
	const { schema } = view;
	const lines = [
		...rootBlock('Query', schema.getQueryType() ?? undefined),
		...(mutations
			? rootBlock('Mutation', schema.getMutationType() ?? undefined)
			: []),
		`Types: ${[...view.types.keys()].join(', ')}`,
		'',
		'Next: call graphql_schema with { types: ["Name"] } for the SDL of a type, or { search: "word" } to find types by name or description.',
	];
	return textResult(lines.join('\n'));
}

function sdlOf(view: View, names: readonly string[]): string {
	const texts = names.map((name) => view.types.get(name) as string);
	return [...directivesUsedBy(view, texts), ...texts].join('\n\n');
}

/** `types`: the SDL of the named types; unknown names are listed with a fix. */
export function typesSdl(view: View, names: readonly string[]) {
	const known = names.filter((name) => view.types.has(name));
	const unknown = names.filter((name) => !view.types.has(name));
	const notes = unknown.map(
		(name) =>
			`# Unknown type ${name}. Fix: call graphql_schema with no input to list the type names you can use.`,
	);
	const body = known.length > 0 ? sdlOf(view, known) : '';
	return textResult(
		[body, ...notes].filter(Boolean).join('\n\n'),
		known.length === 0,
	);
}

function words(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}_]+/u)
		.filter(Boolean);
}

function haystack(type: GraphQLNamedType): string {
	const parts: (string | null | undefined)[] = [type.name, type.description];
	if (isObjectType(type) || isInterfaceType(type) || isInputObjectType(type))
		for (const field of Object.values(type.getFields()))
			parts.push(field.name, field.description);
	if (isEnumType(type))
		for (const value of type.getValues())
			parts.push(value.name, value.description);
	return parts.filter(Boolean).join(' ').toLowerCase();
}

/** `search`: the SDL of the types whose name, description, field or value names and descriptions hold every word. */
export function searchSdl(view: View, search: string) {
	const wanted = words(search);
	if (wanted.length === 0)
		return textResult(
			'Empty search. Fix: pass a word of a type or field name or description, or call graphql_schema with no input for the overview.',
			true,
		);
	const matches = [...view.types.keys()].filter((name) => {
		const type = view.schema.getType(name);
		if (!type) return false;
		const text = haystack(type);
		return wanted.every((word) => text.includes(word));
	});
	if (matches.length === 0)
		return textResult(
			`No type matches "${search}". Fix: try one word, or call graphql_schema with no input for the overview.`,
			true,
		);
	const shown = matches.slice(0, SEARCH_LIMIT);
	const more =
		matches.length > shown.length
			? `\n\n# ${matches.length - shown.length} more types match. Fix: narrow the search with another word.`
			: '';
	return textResult(sdlOf(view, shown) + more);
}
