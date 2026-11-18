import { GraxiaConfigError } from '../errors/config-error';
import {
	DEFAULT_LIMIT_CODE,
	type FieldLimit,
	type FieldRateLimitOptions,
} from './types';

/** A field's rule once validated. */
export interface ResolvedRule {
	readonly limit: FieldLimit;
	readonly single: boolean;
}

/** {@link FieldRateLimitOptions} with defaults applied and validated. */
export interface ResolvedFieldRateLimit {
	readonly rules: ReadonlyMap<string, ResolvedRule>;
	readonly key: FieldRateLimitOptions['key'];
	readonly ipv6Prefix: number | undefined;
	readonly code: string;
}

const isLimit = (value: unknown): value is FieldLimit =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as FieldLimit).consume === 'function';

function rule(name: string, value: unknown): ResolvedRule {
	if (isLimit(value)) return { limit: value, single: false };
	const given = value as { limit?: unknown; single?: unknown } | null;
	if (
		typeof given === 'object' &&
		given !== null &&
		isLimit(given.limit) &&
		(given.single === undefined || typeof given.single === 'boolean')
	)
		return { limit: given.limit, single: given.single === true };
	throw new GraxiaConfigError(
		`fieldRateLimit: fields.${name} must be a limit ({ consume }) or { limit, single? }`,
	);
}

/**
 * Validates the options of `fieldRateLimit`.
 * @throws {GraxiaConfigError} on an empty `fields`, a rule without `consume`, a bad `ipv6Prefix` or `code`.
 */
export function resolveFieldRateLimit(
	options: FieldRateLimitOptions,
): ResolvedFieldRateLimit {
	const { fields, key, ipv6Prefix, code = DEFAULT_LIMIT_CODE } = options ?? {};
	if (
		typeof fields !== 'object' ||
		fields === null ||
		Object.keys(fields).length === 0
	)
		throw new GraxiaConfigError(
			'fieldRateLimit: fields must be an object with at least one field name',
		);
	if (
		ipv6Prefix !== undefined &&
		(!Number.isInteger(ipv6Prefix) || ipv6Prefix < 0 || ipv6Prefix > 128)
	)
		throw new GraxiaConfigError(
			'fieldRateLimit: ipv6Prefix must be an integer from 0 to 128',
		);
	if (ipv6Prefix !== undefined && key !== undefined)
		throw new GraxiaConfigError(
			'fieldRateLimit: ipv6Prefix only applies to the default key; reduce the address inside key() instead',
		);
	if (typeof code !== 'string' || code === '')
		throw new GraxiaConfigError(
			'fieldRateLimit: code must be a non-empty string',
		);
	return {
		rules: new Map(
			Object.entries(fields).map(([name, value]) => [name, rule(name, value)]),
		),
		key,
		ipv6Prefix,
		code,
	};
}
