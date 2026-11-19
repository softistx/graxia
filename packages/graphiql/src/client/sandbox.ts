/**
 * The Apollo Sandbox bootstrap: reads `data-config` and starts Apollo's
 * `EmbeddedSandbox` (loaded by the page from Apollo's CDN) on this endpoint.
 * No inline script or style: the page's own styles go through a constructed
 * stylesheet, which a `style-src 'self'` policy allows.
 */
export {};

interface EmbeddedSandboxOptions {
	target: string;
	initialEndpoint: string;
	initialSubscriptionEndpoint?: string;
	initialState: Record<string, unknown>;
	endpointIsEditable: boolean;
	hideCookieToggle: boolean;
	runTelemetry: boolean;
	allowDynamicStyles: boolean;
}

declare global {
	interface Window {
		EmbeddedSandbox?: new (options: EmbeddedSandboxOptions) => unknown;
	}
}

const root = document.getElementById('sandbox');
if (!root) throw new Error('apollo-sandbox: #sandbox is missing');
if (!window.EmbeddedSandbox)
	throw new Error('apollo-sandbox: the Apollo embed script did not load');
const config = JSON.parse(root.dataset['config'] ?? '{}') as {
	title?: string;
	subscriptions?: boolean;
	initialState?: Record<string, unknown>;
};
document.title = config.title ?? 'Apollo Sandbox';

const sheet = new CSSStyleSheet();
sheet.replaceSync(
	'body{margin:0}#sandbox{position:absolute;inset:0}iframe{width:100%;height:100%;border:0;background:#fff}',
);
document.adoptedStyleSheets = [sheet];

const endpoint = location.origin + location.pathname;

new window.EmbeddedSandbox({
	target: '#sandbox',
	initialEndpoint: endpoint,
	...(config.subscriptions
		? { initialSubscriptionEndpoint: endpoint.replace(/^http/, 'ws') }
		: {}),
	initialState: config.initialState ?? {},
	endpointIsEditable: false,
	hideCookieToggle: false,
	runTelemetry: false,
	allowDynamicStyles: false,
});
