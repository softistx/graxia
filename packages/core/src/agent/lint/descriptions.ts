import {
	type GraphQLField,
	type GraphQLNamedType,
	isInterfaceType,
	isObjectType,
} from 'graphql';
import { restatesName } from '../words';
import type { LintIssue } from './types';

interface Described {
	name: string;
	description?: string | null | undefined;
}

/** The issues of one definition's description, at most one. */
export function checkDescription(
	coordinate: string,
	kind: string,
	item: Described,
	minLength: number,
	required: boolean,
): LintIssue[] {
	const text = item.description?.trim() ?? '';
	if (text === '')
		return required
			? [
					{
						coordinate,
						rule: 'missing-description',
						message: `${coordinate} has no description.`,
						fix: `Add a description to the ${kind} ${coordinate}: say what it is for and when it is used.`,
					},
				]
			: [];
	if (restatesName(item.name, text))
		return [
			{
				coordinate,
				rule: 'name-only-description',
				message: `The description of ${coordinate} only repeats its name.`,
				fix: `Say what ${coordinate} means for a caller (its unit, format, limits or effect), not its name again.`,
			},
		];
	if (text.length < minLength)
		return [
			{
				coordinate,
				rule: 'short-description',
				message: `The description of ${coordinate} is ${text.length} characters, under ${minLength}.`,
				fix: `Write at least ${minLength} characters for ${coordinate}: what it is, and what the caller must know to use it.`,
			},
		];
	return [];
}

/** The description a field takes from the interface field it implements, when it has none. */
export function inherited(
	type: GraphQLNamedType,
	field: GraphQLField<any, any>,
): string | undefined {
	if (!isObjectType(type) && !isInterfaceType(type)) return undefined;
	for (const iface of type.getInterfaces()) {
		const text = iface.getFields()[field.name]?.description;
		if (text) return text;
	}
	return undefined;
}
