import { describe, expect, test } from 'bun:test';
import * as api from './index';

describe('public exports', () => {
	test('internals are not exported', () => {
		for (const name of [
			'createPluginEngine',
			'orderPlugins',
			'createLruCache',
			'createDocumentPipeline',
			'PARSE_FAILED',
			'RequestState',
			'StateBag',
			'requestIdKey',
		])
			expect(name in api).toBe(false);
	});

	test('the supported surface is exported', () => {
		for (const name of [
			'createGraxia',
			'createSchema',
			'definePlugin',
			'createStateKey',
			'getRequestId',
			'getContext',
			'tryGetContext',
			'exposedError',
			'createMemoryPubSub',
			'createMemoryCache',
			'filterIterable',
			'mapIterable',
		])
			expect(name in api).toBe(true);
	});
});
