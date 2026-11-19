/** How the page runs subscriptions. */
export type Subscriptions = 'ws' | 'sse' | false;

/** Options of {@link graphiql}. */
export interface GraphiQLOptions {
	/**
	 * Serve the page. Default: `process.env.NODE_ENV !== 'production'`. `false`
	 * leaves the plugin without hooks. `true` in production is allowed and is a
	 * risk (see the guide).
	 */
	enabled?: boolean;
	/** The page title. Default `"GraphiQL"`. */
	title?: string;
	/** The query the editor starts with. */
	defaultQuery?: string;
	/** The initial content of the headers editor (sent as JSON). */
	headers?: Record<string, string>;
	/** Keep the headers editor's content in local storage. Default `false`. */
	shouldPersistHeaders?: boolean;
	/**
	 * How the page runs subscriptions: `'ws'` (graphql-transport-ws on the same
	 * path), `'sse'` (distinct connections mode) or `false`. Default: detected
	 * from the instance, `'ws'` if its WebSocket is on, else `'sse'` if its SSE
	 * is on, else `false`. An explicit value wins.
	 */
	subscriptions?: Subscriptions;
}

/** The config the page hands its script, as JSON. */
export interface ClientConfig {
	title: string;
	defaultQuery?: string;
	headers?: Record<string, string>;
	shouldPersistHeaders: boolean;
	subscriptions: Subscriptions;
}

/** The transport to use when `subscriptions` is not set: the best one the instance has on. */
export function detectSubscriptions(transports: {
	readonly sse: boolean;
	readonly ws: boolean;
}): Subscriptions {
	return transports.ws ? 'ws' : transports.sse ? 'sse' : false;
}

export function clientConfig(
	options: GraphiQLOptions,
	detected: Subscriptions,
): ClientConfig {
	return {
		title: options.title ?? 'GraphiQL',
		...(options.defaultQuery !== undefined
			? { defaultQuery: options.defaultQuery }
			: {}),
		...(options.headers ? { headers: options.headers } : {}),
		shouldPersistHeaders: options.shouldPersistHeaders ?? false,
		subscriptions: options.subscriptions ?? detected,
	};
}
