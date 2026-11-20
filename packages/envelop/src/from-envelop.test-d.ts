import type { Empty, GraxiaPlugin } from '@softistx/graxia';
import { createGraxia, createSchema } from '@softistx/graxia';
import { fromEnvelop } from './index';

interface User {
	id: string;
}

const schema = createSchema<{ currentUser: User }>()({
	typeDefs: 'type Query { me: String }',
	resolvers: { Query: { me: (_p, _a, ctx) => ctx.currentUser.id } },
});

// Without a type argument the plugin adds nothing.
const none: GraxiaPlugin<Empty, Empty> = fromEnvelop([]);

// `Added` declares what the Envelop plugins put in the context.
const auth = fromEnvelop<{ currentUser: User }>([]);
createGraxia({ schema, plugins: [auth] });

// @ts-expect-error a schema that needs currentUser is refused without the plugin that adds it
createGraxia({ schema, plugins: [none] });

// @ts-expect-error an entry must be a plugin object or a falsy value
fromEnvelop(['useDepthLimit']);

// @ts-expect-error an unknown option
fromEnvelop([], { nme: 'x' });

fromEnvelop([false, null, undefined], { name: 'auth', enforce: 'pre' });

export { none };
