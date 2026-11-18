/** A plain object: not `null`, not an array. */
export const isRecord = (value: unknown): value is Record<string, any> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
