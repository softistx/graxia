import type { ClientConfig } from './options';

/** Escapes a value for a double-quoted HTML attribute (and text). */
export function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/** The asset URL on the endpoint itself: `?graphiql-asset=<file>`. */
export function assetHref(file: string): string {
	return `?graphiql-asset=${encodeURIComponent(file)}`;
}

/** The page: no inline script, the config in a data attribute, hashed assets. */
export function renderPage(
	config: ClientConfig,
	assets: { script: string; style: string },
): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttribute(config.title)}</title>
<link rel="stylesheet" href="${escapeAttribute(assetHref(assets.style))}">
</head>
<body style="margin:0;height:100vh">
<div id="graphiql" style="height:100vh" data-config="${escapeAttribute(JSON.stringify(config))}"></div>
<script type="module" src="${escapeAttribute(assetHref(assets.script))}"></script>
</body>
</html>
`;
}

/**
 * The CSP of the page. GraphiQL 4 sets inline styles at run time, hence
 * `'unsafe-inline'` for styles only; scripts stay `'self'`. `wsOrigin` is the
 * same-host `ws(s)://` origin when subscriptions run over WebSocket.
 */
export function contentSecurityPolicy(wsOrigin: string | undefined): string {
	return [
		"default-src 'none'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self' data:",
		`connect-src 'self'${wsOrigin ? ` ${wsOrigin}` : ''}`,
		"worker-src 'none'",
		"frame-ancestors 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	].join('; ');
}
