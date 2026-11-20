import { definePlugin } from '../plugins/define';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from './create-graxia';
import { schema as plainSchema } from './fixtures.test-util';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

type Host = { request: Request; db: string };

const needsRequest = definePlugin<{ request: Request }>()({
	name: 'needs-request',
	onContext: () => ({ a: 1 }),
});
const needsDb = definePlugin<{ db: string }>()({
	name: 'needs-db',
	onContext: () => ({}),
});
const needsUser = definePlugin<{ user: string }>()({
	name: 'needs-user',
	onContext: () => ({}),
});

const typeDefs = 'type Query { me: String }';
const hostSchema = createSchema<Host>()({ typeDefs });

// the host provides what the schema needs
createGraxia<Host>()({ schema: hostSchema });
// the host provides what the plugins require
createGraxia<Host>()({ schema: plainSchema, plugins: [needsRequest, needsDb] });
// the factory's result provides it too, and a plugin's result feeds the next
createGraxia<{ x: string }>()({
	schema: plainSchema,
	context: () => ({ db: 'x' }),
	plugins: [needsDb],
});
createGraxia<{ request: Request }>()({
	schema: plainSchema,
	plugins: [needsRequest, definePlugin<{ a: number }>()({ name: 'next' })],
});
// a host with no context factory, and the default host
createGraxia<Host>()({ schema: plainSchema });
createGraxia()({ schema: plainSchema });

// the schema's needed context is checked
// @ts-expect-error the schema needs `db` and `request`, the host has `x`
createGraxia<{ x: string }>()({ schema: hostSchema });
// @ts-expect-error the schema needs `request`, the host has no context
createGraxia()({ schema: createSchema<{ request: Request }>()({ typeDefs }) });

// each plugin's required context is checked
// @ts-expect-error `user` is provided by nothing
createGraxia<Host>()({ schema: plainSchema, plugins: [needsUser] });
createGraxia<{ request: Request }>()({
	schema: plainSchema,
	// @ts-expect-error `db` is missing from the host
	plugins: [needsRequest, needsDb],
});
// @ts-expect-error the host provides `db` as a number
createGraxia<{ db: number }>()({ schema: plainSchema, plugins: [needsDb] });

// the result equals the uncurried call's
const direct = createGraxia({ schema: plainSchema });
const curried = createGraxia()({ schema: plainSchema });
assertType<Equal<typeof direct, typeof curried>>();
const hosted = createGraxia<Host>()({ schema: hostSchema });
const sameHost = createGraxia({
	schema: hostSchema,
	context: (_init: import('./options').ContextInit<Host>) => ({}),
});
assertType<Equal<typeof hosted, typeof sameHost>>();

// the factory's result fills a schema need of the curried form
const extraSchema = createSchema<{ db: string; extra: number }>()({ typeDefs });
createGraxia<{ db: string }>()({
	schema: extraSchema,
	context: () => ({ extra: 1 }),
});
createGraxia<{ db: string }>()({
	schema: extraSchema,
	// @ts-expect-error `extra` is a string, the schema needs a number
	context: () => ({ extra: 'no' }),
});

// a forgotten options argument leaves a function, not a server
// @ts-expect-error `createGraxia()` returns the curried function
createGraxia().fetch;
