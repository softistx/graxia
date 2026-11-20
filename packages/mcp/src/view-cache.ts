import type { GraphQLSchema } from 'graphql';
import type { McpAuthInfo } from './auth/types';
import type { Can } from './options';
import { buildView, type View } from './view';

/** Builds the caller's view on first use, once per request: `fetch` asks for it only when the request lists or calls tools. */
export type ViewSource = (
	request: Request,
	serverContext: object,
	auth: McpAuthInfo | undefined,
) => () => Promise<View>;

/**
 * Without `can` every caller sees the same schema, so the view is built once;
 * with `can` it is built once per request that needs it (`tools/list`,
 * `tools/call`), never for `initialize`, `ping` or a notification.
 */
export function createViewSource(
	schema: GraphQLSchema,
	can:
		| ((
				request: Request,
				serverContext: any,
				auth?: McpAuthInfo,
		  ) => Can | Promise<Can>)
		| undefined,
): ViewSource {
	let shared: View | undefined;
	const viewOf = async (
		request: Request,
		serverContext: object,
		auth: McpAuthInfo | undefined,
	) => {
		if (can)
			return buildView(
				schema,
				await (auth
					? can(request, serverContext, auth)
					: can(request, serverContext)),
			);
		shared ??= buildView(schema);
		return shared;
	};
	return (request, serverContext, auth) => {
		let pending: Promise<View> | undefined;
		return () => {
			pending ??= viewOf(request, serverContext, auth);
			return pending;
		};
	};
}
