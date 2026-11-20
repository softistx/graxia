import { AsyncLocalStorage } from 'node:async_hooks';
import type { McpAuthInfo } from './types';

const storage = new AsyncLocalStorage<McpAuthInfo | undefined>();

/**
 * Runs `fn` with `info` as the verified principal (`mcpAuth()` reads it).
 * `undefined` is stored too, so an instance without `auth` called from inside
 * another instance's tool call does not see that one's principal.
 */
export function runAs<T>(info: McpAuthInfo | undefined, fn: () => T): T {
	return storage.run(info, fn);
}

/**
 * The verified token of the MCP request being handled, for graxia's `context`
 * builder and resolvers: the verification already happened, do not repeat it.
 * `undefined` outside a tool call, and when `createMcp` has no `auth`.
 *
 * @example
 * createGraxia({ schema, context: () => ({ user: mcpAuth()?.subject }) });
 */
export function mcpAuth(): McpAuthInfo | undefined {
	return storage.getStore();
}
