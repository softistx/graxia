/** What the Sandbox opens with. */
export interface SandboxInitialState {
	/** The operation in the editor. */
	document?: string;
	/** The variables, an object. */
	variables?: Record<string, unknown>;
	/** The request headers, rendered into the HTML: put no secret here. */
	headers?: Record<string, string>;
	/** Send cookies with the requests. Default `false`. */
	includeCookies?: boolean;
}

/** Options of {@link apolloSandbox}. */
export interface ApolloSandboxOptions {
	/**
	 * Serve the page. Default: `process.env.NODE_ENV !== 'production'` (an unset
	 * `NODE_ENV` serves it). `false` leaves the plugin without hooks. A function
	 * `(request) => boolean` decides for each request the explorer would answer;
	 * `false` falls through as a disabled explorer does. `true` in production is
	 * a risk (see the guide).
	 */
	enabled?: boolean | ((request: Request) => boolean);
	/** The page title. Default `"Apollo Sandbox"`. */
	title?: string;
	/** What the Sandbox opens with. */
	initialState?: SandboxInitialState;
}

/** The config the bootstrap reads, as JSON in `data-config`. */
export interface SandboxConfig {
	title: string;
	/** The instance has its WebSocket on: the Sandbox runs subscriptions over it. */
	subscriptions: boolean;
	initialState: Record<string, unknown>;
}

export function sandboxConfig(
	options: ApolloSandboxOptions,
	subscriptions: boolean,
): SandboxConfig {
	const { document, variables, headers, includeCookies } =
		options.initialState ?? {};
	return {
		title: options.title ?? 'Apollo Sandbox',
		subscriptions,
		initialState: {
			...(document !== undefined ? { document } : {}),
			...(variables !== undefined ? { variables } : {}),
			...(headers !== undefined ? { headers } : {}),
			includeCookies: includeCookies ?? false,
		},
	};
}
