import { definePlugin } from '../plugins/define';
import type { GraxiaPlugin } from '../plugins/types';
import { createGraxia } from './create-graxia';
import { schema } from './fixtures.test-util';
import type { ContextInit } from './options';

const auth = definePlugin<{ request: Request }>()({
	name: 'auth',
	onContext: ({ context }) => ({ agent: context.request.url }),
});
const needsAgent = definePlugin<{ agent: string }>()({
	name: 'needs-agent',
	onContext: () => ({}),
});
const needsDb = definePlugin<{ db: string }>()({
	name: 'needs-db',
	onContext: () => ({}),
});
const bare = definePlugin({ name: 'bare', onContext: () => ({ a: 1 }) });
const bareHook = definePlugin()({ name: 'bare-hook' });
const untyped: GraxiaPlugin<any, any> = { name: 'untyped' };

// the host context type, declared on the factory's `init` (as `serverContext`)
const withRequest = (_init: ContextInit<{ request: Request }>) => ({});
// provided by the host context type
createGraxia({ schema, context: withRequest, plugins: [auth] });
// provided by the context factory
createGraxia({
	schema,
	context: () => ({ db: 'x' }),
	plugins: [needsDb],
});
// added by an earlier plugin and consumed by a later one
createGraxia({ schema, context: withRequest, plugins: [auth, needsAgent] });
// no requirement, no `In`, untyped, none given
createGraxia({ schema, plugins: [bare, bareHook, untyped] });
createGraxia({
	schema,
	plugins: [untyped, needsDb],
	context: () => ({ db: 'x' }),
});
createGraxia({ schema });

// @ts-expect-error `request` is not in the host context
createGraxia({ schema, plugins: [auth] });
// @ts-expect-error `db` is missing, `request` is there
createGraxia({ schema, context: withRequest, plugins: [auth, needsDb] });
// @ts-expect-error `agent` is added by `auth`, which comes after
createGraxia({ schema, context: withRequest, plugins: [needsAgent, auth] });
// @ts-expect-error wrong type for `db`
createGraxia({ schema, context: () => ({ db: 1 }), plugins: [needsDb] });
