import type { GraphQLFormattedError } from 'graphql';

/**
 * Throws when a result carries GraphQL errors, listing each message, code
 * and path, so a failing test says why. Accepts an execution result or a
 * test client result.
 *
 * @example
 * const result = await client.query('{ hello }');
 * expectNoErrors(result);
 */
export function expectNoErrors(result: {
	errors?: readonly GraphQLFormattedError[] | undefined;
}): void {
	const { errors } = result;
	if (!errors || errors.length === 0) return;
	const lines = errors.map((error) => {
		const code = error.extensions?.['code'];
		const path = error.path ? ` at ${error.path.join('.')}` : '';
		return `- ${error.message}${code !== undefined ? ` [${String(code)}]` : ''}${path}`;
	});
	throw new Error(
		`Expected no GraphQL errors, got ${errors.length}:\n${lines.join('\n')}`,
	);
}
