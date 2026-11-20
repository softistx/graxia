import * as refuse from './refuse';
import type { Adapter, AnyPlugin, ContextErrorHandler, Entry } from './types';

/**
 * Flattens the given plugins the way Envelop's orchestrator does: runs each
 * `onPluginInit`, inserts the plugins it adds right after it (their own
 * `onPluginInit` runs in turn), collects the context error handlers, then
 * checks every hook name. Everything graxia cannot run is refused here, at
 * boot.
 */
export function flatten(
	given: readonly (AnyPlugin | false | null | undefined)[],
): Adapter {
	const list: AnyPlugin[] = [];
	const live = given.filter((plugin) => Boolean(plugin));
	live.forEach((plugin, i) => {
		if (typeof plugin !== 'object' || plugin === null)
			throw refuse.notAnObject(i + 1, live.length, plugin);
		list.push(plugin);
	});
	const errorHandlers: ContextErrorHandler[] = [];
	for (let i = 0; i < list.length; i++) {
		const plugin = list[i] as AnyPlugin;
		const added: AnyPlugin[] = [];
		const label = () => refuse.labelOf(i + 1, list.length, plugin);
		plugin.onPluginInit?.({
			plugins: list,
			addPlugin: (next) => void added.push(next as AnyPlugin),
			setSchema: () => {
				throw refuse.setSchema(label());
			},
			registerContextErrorHandler: (handler) =>
				void errorHandlers.push(handler as ContextErrorHandler),
		});
		list.splice(i + 1, 0, ...added);
	}
	const entries = list.map((plugin, i): Entry => {
		const label = refuse.labelOf(i + 1, list.length, plugin);
		check(plugin, label);
		return { plugin, label };
	});
	return { entries, errorHandlers };
}

function check(plugin: AnyPlugin, label: string): void {
	for (const [key, value] of Object.entries(plugin)) {
		if (value === undefined || refuse.SUPPORTED.has(key)) continue;
		if (key === 'instrumentation') throw refuse.instrumentation(label);
		if (refuse.YOGA_KEYS.has(key)) throw refuse.yogaKey(label, key);
		throw refuse.unknownKey(label, key);
	}
}
