import { definePlugin, type GraxiaPlugin } from '@graxia/core';
import { type AssetSource, assetResponse, bundledAssets } from './assets';
import {
	assertSingleExplorer,
	explorerName,
	isEnabled,
	isPageRequest,
	pageResponse,
	SANDBOX,
} from './explorer';
import { escapeAttribute } from './page';

/** The script Apollo's embed loads, on its `v2` channel (the one Apollo Server pins). */
export const EMBED_SCRIPT =
	'https://embeddable-sandbox.cdn.apollographql.com/v2/embeddable-sandbox.umd.production.min.js';
const EMBED_HOST = 'https://embeddable-sandbox.cdn.apollographql.com';
const SANDBOX_HOST = 'https://sandbox.embed.apollographql.com';
const ASSET_PARAM = 'apollo-sandbox-asset';

/**
 * The CSP of the Sandbox page: the two exact Apollo hosts and nothing else
 * external. `script-src` holds the embed script's host, `frame-src` the host
 * of the Sandbox iframe, `connect-src 'self'` the requests the page makes to
 * your endpoint on behalf of the iframe. Styles need no `'unsafe-inline'`.
 */
export const SANDBOX_CSP = [
	"default-src 'none'",
	`script-src 'self' ${EMBED_HOST}`,
	"style-src 'self'",
	'img-src data:',
	"connect-src 'self'",
	`frame-src ${SANDBOX_HOST}`,
	"frame-ancestors 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join('; ');

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
	 * Serve the page. Default: `process.env.NODE_ENV !== 'production'`. `false`
	 * leaves the plugin without hooks. `true` in production is a risk (see the guide).
	 */
	enabled?: boolean;
	/** The page title. Default `"Apollo Sandbox"`. */
	title?: string;
	/** What the Sandbox opens with. */
	initialState?: SandboxInitialState;
}

/** The config the bootstrap reads, as JSON in `data-config`. */
function sandboxConfig(options: ApolloSandboxOptions) {
	const { document, variables, headers, includeCookies } =
		options.initialState ?? {};
	return {
		title: options.title ?? 'Apollo Sandbox',
		initialState: {
			...(document !== undefined ? { document } : {}),
			...(variables !== undefined ? { variables } : {}),
			...(headers !== undefined ? { headers } : {}),
			includeCookies: includeCookies ?? false,
		},
	};
}

/** The page: no inline script or style, the config in a data attribute. */
export function renderSandboxPage(
	options: ApolloSandboxOptions,
	bootstrap: string,
): string {
	const config = sandboxConfig(options);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttribute(config.title)}</title>
<link rel="icon" href="data:,">
</head>
<body>
<div id="sandbox" data-config="${escapeAttribute(JSON.stringify(config))}"></div>
<script src="${EMBED_SCRIPT}"></script>
<script type="module" src="?${ASSET_PARAM}=${encodeURIComponent(bootstrap)}"></script>
</body>
</html>
`;
}

/** @internal `apolloSandbox` with the assets source injected (tests). */
export function createApolloSandbox(
	options: ApolloSandboxOptions,
	source: AssetSource,
): GraxiaPlugin {
	const enabled = isEnabled(options.enabled);
	if (!enabled) return definePlugin({ name: explorerName(SANDBOX, false) });
	const asset = (request: Request) =>
		request.method === 'GET'
			? new URL(request.url).searchParams.get(ASSET_PARAM)
			: null;
	return definePlugin({
		name: SANDBOX,
		setup({ plugins }) {
			assertSingleExplorer(SANDBOX, plugins);
		},
		// The page and its bootstrap load carry no CSRF header; `onRequest` answers both.
		csrfExempt: (request) => asset(request) !== null || isPageRequest(request),
		async onRequest({ request, respond }) {
			const name = asset(request);
			if (name !== null)
				return respond(
					await assetResponse(
						source,
						name,
						request.headers.get('accept-encoding'),
					),
				);
			if (!isPageRequest(request)) return;
			const { sandbox } = await source.manifest();
			respond(pageResponse(renderSandboxPage(options, sandbox), SANDBOX_CSP));
		},
	});
}

/**
 * The Apollo Sandbox page, served by the endpoint itself. It loads Apollo's
 * embed script from Apollo's CDN: development only by default.
 *
 * @example
 * createGraxia({ schema, plugins: [apolloSandbox({ title: 'My API' })] });
 */
export function apolloSandbox(
	options: ApolloSandboxOptions = {},
): GraxiaPlugin {
	return createApolloSandbox(options, bundledAssets());
}
