import { escapeAttribute } from '../page';
import type { SandboxConfig } from './options';

/** The script Apollo's embed loads, on its `v2` channel (the one Apollo Server pins). */
export const EMBED_SCRIPT =
	'https://embeddable-sandbox.cdn.apollographql.com/v2/embeddable-sandbox.umd.production.min.js';
const EMBED_HOST = 'https://embeddable-sandbox.cdn.apollographql.com';
const SANDBOX_HOST = 'https://sandbox.embed.apollographql.com';
export const ASSET_PARAM = 'apollo-sandbox-asset';

/**
 * The CSP of the Sandbox page: the two exact Apollo hosts and nothing else
 * external. `script-src` holds the embed script's host, `frame-src` the host
 * of the Sandbox iframe, `connect-src 'self'` the requests the page makes to
 * your endpoint on behalf of the iframe, plus `wsOrigin` (the same-host
 * `ws(s)://` origin) when subscriptions run over WebSocket. Styles need no
 * `'unsafe-inline'`.
 */
export function sandboxContentSecurityPolicy(
	wsOrigin?: string | undefined,
): string {
	return [
		"default-src 'none'",
		`script-src 'self' ${EMBED_HOST}`,
		"style-src 'self'",
		'img-src data:',
		`connect-src 'self'${wsOrigin ? ` ${wsOrigin}` : ''}`,
		`frame-src ${SANDBOX_HOST}`,
		"frame-ancestors 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	].join('; ');
}

/** The page: no inline script or style, the config in a data attribute. */
export function renderSandboxPage(
	config: SandboxConfig,
	bootstrap: string,
): string {
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
