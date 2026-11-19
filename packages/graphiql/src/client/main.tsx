import { createGraphiQLFetcher, type Fetcher } from '@graphiql/toolkit';
import { GraphiQL } from 'graphiql';
import { getOperationAST, parse } from 'graphql';
import { createClient } from 'graphql-ws';
import 'graphiql/style.css';
import { createRoot } from 'react-dom/client';
import { sseOperation } from './sse';

interface Config {
	title: string;
	defaultQuery?: string;
	headers?: Record<string, string>;
	shouldPersistHeaders: boolean;
	subscriptions: 'ws' | 'sse' | false;
}

const root = document.getElementById('graphiql');
if (!root) throw new Error('graphiql: #graphiql is missing');
const config = JSON.parse(root.dataset['config'] ?? '{}') as Config;
document.title = config.title;

const url = location.origin + location.pathname;

function isSubscription(query: string, operationName?: string | null): boolean {
	try {
		const ast = getOperationAST(parse(query), operationName);
		return ast?.operation === 'subscription';
	} catch {
		return false;
	}
}

function buildFetcher(): Fetcher {
	if (config.subscriptions === 'ws') {
		const wsUrl = url.replace(/^http/, 'ws');
		return createGraphiQLFetcher({
			url,
			wsClient: createClient({ url: wsUrl }),
		});
	}
	const plain = createGraphiQLFetcher({ url });
	if (config.subscriptions !== 'sse') return plain;
	return (params, options) =>
		isSubscription(params.query, params.operationName)
			? sseOperation(url, params, options?.headers ?? {})
			: plain(params, options);
}

createRoot(root).render(
	<GraphiQL
		fetcher={buildFetcher()}
		{...(config.defaultQuery !== undefined
			? { defaultQuery: config.defaultQuery }
			: {})}
		{...(config.headers
			? { defaultHeaders: JSON.stringify(config.headers, null, 2) }
			: {})}
		shouldPersistHeaders={config.shouldPersistHeaders}
		isHeadersEditorEnabled
	/>,
);
