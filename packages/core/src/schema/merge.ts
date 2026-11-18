import { GraphQLScalarType } from 'graphql';
import { GraxiaConfigError } from '../errors/config-error';

type Loose = Record<string, unknown>;

const isPlain = (value: unknown): value is Loose =>
	typeof value === 'object' &&
	value !== null &&
	!(value instanceof GraphQLScalarType);

/**
 * Merges resolver maps per type and field. A field (or enum value, or scalar)
 * defined twice throws a `GraxiaConfigError` naming `Type.field`.
 */
export function mergeResolvers(maps: readonly Loose[]): Loose {
	const out: Loose = {};
	for (const map of maps) {
		for (const [type, value] of Object.entries(map)) {
			const existing = out[type];
			if (existing === undefined) {
				out[type] = isPlain(value) ? { ...value } : value;
			} else if (isPlain(existing) && isPlain(value)) {
				for (const [field, entry] of Object.entries(value)) {
					if (field in existing) {
						throw new GraxiaConfigError(
							`Resolver ${type}.${field} is defined more than once`,
						);
					}
					existing[field] = entry;
				}
			} else {
				throw new GraxiaConfigError(
					`Resolvers for ${type} are defined more than once`,
				);
			}
		}
	}
	return out;
}
