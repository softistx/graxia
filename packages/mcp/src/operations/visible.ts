import { validate } from 'graphql';
import { VIEW_RULES } from '../tools/operation';
import type { View } from '../view';
import type { OperationTool } from './types';

/** The typed tools a caller may use: those whose operation is valid against the caller's view. */
export type VisibleTools = (view: View) => readonly OperationTool[];

/**
 * Filters the tools by view, once per view: without `can` every caller
 * shares one view, so the list is computed once; with `can` once per request.
 */
export function createVisibleTools(
	tools: readonly OperationTool[],
): VisibleTools {
	const cache = new WeakMap<View, readonly OperationTool[]>();
	return (view) => {
		let visible = cache.get(view);
		if (!visible) {
			visible = tools.filter(
				(tool) => validate(view.schema, tool.document, VIEW_RULES).length === 0,
			);
			cache.set(view, visible);
		}
		return visible;
	};
}
