import type { GraphQLSchema } from 'graphql';
import type { Can } from './options';
import { buildView, type View } from './view';

/** Builds the caller's view on first use: initialize and `tools/list` never pay for it. */
export type ViewSource = (
	request: Request,
	serverContext: object,
) => () => Promise<View>;

/**
 * Without `can` every caller sees the same schema, so the view is built once;
 * with `can` it is built once per request that needs it.
 */
export function createViewSource(
	schema: GraphQLSchema,
	can:
		| ((request: Request, serverContext: any) => Can | Promise<Can>)
		| undefined,
): ViewSource {
	let shared: View | undefined;
	const viewOf = async (request: Request, serverContext: object) => {
		if (can) return buildView(schema, await can(request, serverContext));
		shared ??= buildView(schema);
		return shared;
	};
	return (request, serverContext) => {
		let pending: Promise<View> | undefined;
		return () => {
			pending ??= viewOf(request, serverContext);
			return pending;
		};
	};
}
