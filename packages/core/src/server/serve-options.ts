import type { SocketData } from '../ws/connection';

/** What graxia attaches to each upgraded socket (`ws.data`); opaque to the host. */
export type GraxiaSocketData = SocketData;

/** The `Bun.serve` options graxia forwards (host and port; not `fetch`, `routes` or unix sockets). */
export type GraxiaServeOptions =
	Bun.Serve.HostnamePortServeOptions<GraxiaSocketData>;
