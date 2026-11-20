import { createGraxia, createSchema } from '@graxia/core';
import { type Ctx, context, newResponseSet } from './context';
import { schema } from './schema';

const graxia = createGraxia({ schema, context });
const request = new Request('http://localhost/api/graphql');

// the host passes its context on every request
await graxia.fetch(request, { set: newResponseSet(), user: 'ada' });

// @ts-expect-error serverContext is required: a request without it has no `set`
await graxia.fetch(request);

// @ts-expect-error `set` has no value of another shape
await graxia.fetch(request, { set: new Headers(), user: undefined });

// a resolver cannot read what the context does not hold
createSchema<Ctx>()({
	typeDefs: 'type Query { t: String }',
	resolvers: {
		Query: {
			// @ts-expect-error `tenant` is not in the context
			t: (_: unknown, __: unknown, ctx) => ctx.tenant,
		},
	},
});
