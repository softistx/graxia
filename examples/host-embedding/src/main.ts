import { createApp } from './app';

const app = createApp({ port: Number(process.env['PORT'] ?? 3000) });
console.log(`GraphQL at ${app.url}/api/graphql`);

const shutdown = async () => {
	await app.stop();
	process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
