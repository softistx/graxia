import { AsyncLocalStorage } from 'node:async_hooks';
import type { McpAuthInfo } from './types';

const storage = new AsyncLocalStorage<McpAuthInfo>();

/** Runs `fn` with `info` as the verified principal (`mcpAuth()` reads it). */
export function runAs<T>(info: McpAuthInfo | undefined, fn: () => T): T {
	return info === undefined ? fn() : storage.run(info, fn);
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
