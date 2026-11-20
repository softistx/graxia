import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '@softistx/graxia';
import { fromEnvelop } from './from-envelop';

const message = (plugins: unknown[]) => {
	try {
		fromEnvelop(plugins as never);
	} catch (error) {
		expect(error).toBeInstanceOf(GraxiaConfigError);
		return (error as Error).message;
	}
	throw new Error('did not throw');
};

describe('fromEnvelop', () => {
	test('an empty list is a plugin that does nothing', () => {
		const plugin = fromEnvelop([]);
		expect(plugin.name).toBe('envelop');
		expect(plugin.onExecute).toBeUndefined();
		expect(plugin.onContext).toBeUndefined();
	});

	test('falsy entries are skipped', () => {
		expect(() => fromEnvelop([false, null, undefined, {}])).not.toThrow();
	});

	test('name and enforce are passed through', () => {
		const plugin = fromEnvelop([], { name: 'auth', enforce: 'pre' });
		expect(plugin.name).toBe('auth');
		expect(plugin.enforce).toBe('pre');
	});

	test('a non-object entry says what to pass', () => {
		expect(message([{}, 'useDepthLimit'])).toBe(
			'fromEnvelop: entry 2 of 2 is string, not an Envelop plugin object. Pass a plugin such as useDepthLimit({ maxDepth: 10 }), or a falsy value (cond && usePlugin()) to skip one.',
		);
	});

	test('instrumentation is refused with the alternative', () => {
		expect(message([{ instrumentation: {} }])).toBe(
			'fromEnvelop: envelop plugin 1 of 1 (instrumentation) uses "instrumentation", which graxia cannot run. Remove it, or use createGraxia({ telemetry }) or a graxia plugin (definePlugin) instead.',
		);
	});

	test.each([
		'onRequest',
		'onRequestParse',
		'onParams',
		'onResultProcess',
		'onResponse',
		'onYogaInit',
		'onExecutionResult',
	])('the yoga hook %s is refused', (key) => {
		expect(message([{ [key]: () => {} }])).toContain(
			`uses "${key}": this is a graphql-yoga plugin, not an Envelop one, and graxia cannot run it. Rewrite it with definePlugin from @softistx/graxia.`,
		);
	});

	test('an unknown key is refused', () => {
		expect(message([{ onParsee: () => {} }])).toContain(
			'uses "onParsee", which is not an Envelop hook graxia knows. Check the spelling',
		);
	});
});
