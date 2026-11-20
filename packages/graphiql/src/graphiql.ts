import { definePlugin, type GraxiaPlugin } from '@graxia/core';
import { type AssetSource, assetResponse, bundledAssets } from './assets';
import {
	assertSingleExplorer,
	explorerName,
	GRAPHIQL,
	isPageRequest,
	pageResponse,
	resolveEnabled,
} from './explorer';
import {
	clientConfig,
	detectSubscriptions,
	type GraphiQLOptions,
	type Subscriptions,
} from './options';
import { contentSecurityPolicy, renderPage } from './page';

const ASSET_PARAM = 'graphiql-asset';

type Kind = { page: true } | { asset: string } | undefined;

/** What a request asks of the plugin: the page, one asset, or nothing. */
function classify(request: Request): Kind {
	if (request.method !== 'GET') return undefined;
	const { searchParams } = new URL(request.url);
	const asset = searchParams.get(ASSET_PARAM);
	if (asset !== null) return { asset };
	return isPageRequest(request) ? { page: true } : undefined;
}

function renderResponse(
	request: Request,
	options: GraphiQLOptions,
	assets: { script: string; style: string },
	detected: Subscriptions,
): Response {
	const config = clientConfig(options, detected);
	const url = new URL(request.url);
	const wsOrigin =
		config.subscriptions === 'ws'
			? `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`
			: undefined;
	return pageResponse(
		renderPage(config, assets),
		contentSecurityPolicy(wsOrigin),
	);
}

/** @internal `graphiql` with the assets source injected (tests). */
export function createGraphiQL(
	options: GraphiQLOptions,
	source: AssetSource,
): GraxiaPlugin {
	const gate = resolveEnabled(options.enabled);
	if (!gate.on) return definePlugin({ name: explorerName(GRAPHIQL, false) });
	let detected: Subscriptions = 'sse';
	return definePlugin({
		name: GRAPHIQL,
		setup({ transports, plugins }) {
			assertSingleExplorer(GRAPHIQL, plugins);
			detected = detectSubscriptions(transports);
		},
		// A browser navigation and the page's own script and style loads carry
		// no CSRF header: only these GETs are exempt, and `onRequest` answers
		// them (core refuses an exempt GET that no plugin answers).
		csrfExempt: (request) =>
			classify(request) !== undefined && gate.allows(request),
		async onRequest({ request, respond }) {
			const kind = classify(request);
			if (!kind || !gate.allows(request)) return;
			if ('asset' in kind)
				return respond(
					await assetResponse(
						source,
						kind.asset,
						request.headers.get('accept-encoding'),
					),
				);
			respond(
				renderResponse(request, options, await source.manifest(), detected),
			);
		},
	});
}

/**
 * The GraphiQL page, served by the endpoint itself, bundled for a strict CSP.
 *
 * @example
 * createGraxia({ schema, plugins: [graphiql({ title: 'My API' })] });
 */
export function graphiql(options: GraphiQLOptions = {}): GraxiaPlugin {
	return createGraphiQL(options, bundledAssets());
}
