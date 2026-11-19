import { definePlugin, type GraxiaPlugin } from '@graxia/core';
import { type AssetSource, assetResponse, bundledAssets } from '../assets';
import {
	assertSingleExplorer,
	explorerName,
	isEnabled,
	isPageRequest,
	pageResponse,
	SANDBOX,
} from '../explorer';
import { detectSubscriptions } from '../options';
import { type ApolloSandboxOptions, sandboxConfig } from './options';
import {
	ASSET_PARAM,
	renderSandboxPage,
	sandboxContentSecurityPolicy,
} from './page';

export type { ApolloSandboxOptions, SandboxInitialState } from './options';
export { sandboxContentSecurityPolicy } from './page';

/** @internal `apolloSandbox` with the assets source injected (tests). */
export function createApolloSandbox(
	options: ApolloSandboxOptions,
	source: AssetSource,
): GraxiaPlugin {
	const enabled = isEnabled(options.enabled);
	if (!enabled) return definePlugin({ name: explorerName(SANDBOX, false) });
	let ws = false;
	const asset = (request: Request) =>
		request.method === 'GET'
			? new URL(request.url).searchParams.get(ASSET_PARAM)
			: null;
	return definePlugin({
		name: SANDBOX,
		setup({ plugins, transports }) {
			assertSingleExplorer(SANDBOX, plugins);
			// Only graphql-transport-ws: Apollo's Sandbox does not speak graphql-sse.
			ws = detectSubscriptions(transports) === 'ws';
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
			const url = new URL(request.url);
			const wsOrigin = ws
				? `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`
				: undefined;
			respond(
				pageResponse(
					renderSandboxPage(sandboxConfig(options, ws), sandbox),
					sandboxContentSecurityPolicy(wsOrigin),
				),
			);
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
