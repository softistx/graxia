import type { InferContext } from '../../server/infer-context';
import type { ContextInit } from '../../server/options';

/** The context factory the fixture's graxia instance uses. */
export const context = async ({ request }: ContextInit) => ({
	user: { id: request.headers.get('x-user') ?? 'anonymous' },
});

/** The resolver context, written once: what `codegen.ts` points `contextType` at. */
export type FixtureContext = InferContext<typeof context>;
