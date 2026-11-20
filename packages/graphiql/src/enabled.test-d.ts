import { apolloSandbox, graphiql } from './index';

graphiql({ enabled: true });
graphiql({ enabled: () => true });
graphiql({ enabled: (request) => request.headers.has('x-dev') });
apolloSandbox({ enabled: false });
apolloSandbox({ enabled: (request: Request) => request.method === 'GET' });

// @ts-expect-error a string is not a flag
graphiql({ enabled: 'yes' });
// @ts-expect-error a function takes a Request
apolloSandbox({ enabled: (request: string) => request.length > 0 });
// @ts-expect-error an async function returns a Promise, never `true`
graphiql({ enabled: async () => true });
// @ts-expect-error a function returns a boolean
graphiql({ enabled: () => 'yes' });
