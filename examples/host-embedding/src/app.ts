import {
	createGraxia,
	type Graxia,
	type GraxiaSocketData,
} from '@softistx/graxia';
import { context, type HostContext, newResponseSet } from './context';
import { cors } from './cors';
import { withResponseSet } from './respond';
import { schema } from './schema';

export interface AppOptions {
	/** 0 picks a free port. */
	port?: number;
	/** Where the app mounts GraphQL: `${prefix}/graphql`. */
	prefix?: string;
	/** Origins allowed to call GraphQL from a browser. */
	origins?: readonly string[];
	/** Milliseconds `stop()` lets in-flight operations finish. */
	shutdownTimeout?: number;
}

export interface App {
	server: Bun.Server<GraxiaSocketData>;
	graxia: Graxia<HostContext>;
	url: string;
	/** Drains and stops; calling it again returns the same promise. */
	stop(): Promise<void>;
}

/** An app that owns `Bun.serve` and embeds graxia in one of its routes. */
export function createApp({
	port = 0,
	prefix = '/api',
	origins = [],
	shutdownTimeout = 5_000,
}: AppOptions = {}): App {
	const graxia = createGraxia({
		schema,
		// the host routes: graxia serves the one path it is handed
		path: `${prefix}/graphql`,
		context,
		onUnexpected: (error) => console.error('graphql:', error),
	});
	const allow = cors(origins);
	let stopping = false;

	const hostContext = (request: Request): HostContext => ({
		set: newResponseSet(),
		// a stand-in for real authentication
		user: request.headers.get('x-user') ?? undefined,
	});

	async function graphql(
		request: Request,
		server: Bun.Server<GraxiaSocketData>,
	): Promise<Response | undefined> {
		const preflight = allow.preflight(request);
		if (preflight) return preflight;
		const host = hostContext(request);
		if (graxia.isUpgrade(request))
			// `undefined` once the socket is upgraded; a refusal otherwise
			return graxia.upgrade(request, server, host);
		const response = await graxia.fetch(request, host);
		return allow.decorate(request, withResponseSet(response, host.set));
	}

	const server = Bun.serve({
		port,
		routes: {
			'/health': new Response('ok'),
			'/ready': () =>
				new Response(stopping ? 'stopping' : 'ready', {
					status: stopping ? 503 : 200,
				}),
			[`${prefix}/graphql`]: graphql,
		},
		fetch: () => new Response('Not found', { status: 404 }),
		websocket: graxia.websocket,
	});

	let stopped: Promise<void> | undefined;
	/**
	 * Readiness goes 503, graxia drains (in-flight operations answered, new ones
	 * 503, streams completed, sockets closed with 1001), then the server stops.
	 * `dispose()` stops only the servers `graxia.serve()` started: this one is ours.
	 */
	const stop = () =>
		(stopped ??= (async () => {
			stopping = true;
			await graxia.dispose({ timeout: shutdownTimeout });
			await server.stop(true);
		})());

	return { server, graxia, url: `http://localhost:${server.port}`, stop };
}
