/**
 * The request hot path: `graxia.fetch` on three shapes of request, with its
 * throughput (requests per second) and the heap it allocates per request.
 *
 * - `simple, no caches`: `{ hello }` with `caches: false`, so every request
 *   parses and validates;
 * - `2 plugins (cached)`: the same query with two plugins hooking
 *   `onRequest`, `onParams`, `onContext`, `onExecute` (with an after-hook)
 *   and `onResponse`;
 * - `cached document`: the same query, caches on (the default), so parse and
 *   validation are served by the caches after the first request.
 *
 * The request sends the `Accept` header a GraphQL-over-HTTP client sends.
 * Telemetry is off (`telemetry: false`) so the numbers are the engine's own.
 * The `Request` construction is measured on its own (`request only`) and
 * subtracted from the bytes per request.
 *
 * Bytes per request: JSC's heap counters move only at a collection, so a
 * child process per scenario runs with `BUN_JSC_logGC=1`, and the bytes each
 * collection reports as allocated in its cycle (`ca=`) are summed over
 * `ALLOC_OPS` requests (a full collection before and after brackets them).
 * It counts every JS heap allocation, garbage included; native memory
 * (Bun's `Request`, `Response` and `Headers` internals) is not in it.

 * Run: bun run packages/core/bench/request.bench.ts [--quick]
 * Not shipped: `files` and `tsconfig.build.json` only cover `dist` and `src`.
 */
import { createGraxia, createSchema, definePlugin } from '../src';

const quick = process.argv.includes('--quick');
const allocAt = process.argv.indexOf('--alloc');
const allocOf = allocAt >= 0 ? process.argv[allocAt + 1] : undefined;
const WARMUP = quick ? 2_000 : 5_000;
const OPS = quick ? 5_000 : 20_000;
const RUNS = quick ? 3 : 5;
const ALLOC_OPS = quick ? 10_000 : 30_000;

const schema = createSchema()({
	typeDefs: 'type Query { hello: String }',
	resolvers: { Query: { hello: () => 'world' } },
});
const body = JSON.stringify({ query: '{ hello }' });
const make = () =>
	new Request('http://localhost/graphql', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/graphql-response+json, application/json',
		},
		body,
	});

const plugin = (name: string) =>
	definePlugin({
		name,
		onRequest: () => {},
		onParams: () => {},
		onContext: () => ({ [name]: true }),
		onExecute: () => () => {},
		onResponse: () => {},
	});

type Handler = (request: Request) => Promise<unknown>;

interface Scenario {
	name: string;
	make(): { fetch: Handler; dispose(): Promise<void> };
}

const scenarios: Scenario[] = [
	{
		name: 'request only',
		make: () => ({ fetch: async (r) => r, dispose: async () => {} }),
	},
	{
		name: 'simple, no caches',
		make: () => createGraxia({ schema, telemetry: false, caches: false }),
	},
	{
		name: '2 plugins (cached)',
		make: () =>
			createGraxia({
				schema,
				telemetry: false,
				plugins: [plugin('a'), plugin('b')],
			}),
	},
	{
		name: 'cached document',
		make: () => createGraxia({ schema, telemetry: false }),
	},
];

const median = (xs: number[]) =>
	[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

async function check(fetch: Handler): Promise<void> {
	const response = (await fetch(make())) as Response | Request;
	if (!(response instanceof Response)) return;
	const text = await response.text();
	if (response.status !== 200 || !text.includes('world'))
		throw new Error(`unexpected answer ${response.status}: ${text}`);
}

async function throughput(fetch: Handler): Promise<number> {
	const runs: number[] = [];
	for (let r = 0; r < RUNS; r++) {
		const start = Bun.nanoseconds();
		for (let i = 0; i < OPS; i++) await fetch(make());
		runs.push(OPS / ((Bun.nanoseconds() - start) / 1e9));
	}
	return median(runs);
}

/** In the child (`--alloc <scenario>`): runs `ALLOC_OPS` requests between markers. */
async function allocChild(scenario: Scenario): Promise<void> {
	const instance = scenario.make();
	for (let i = 0; i < WARMUP; i++) await instance.fetch(make());
	console.error('@@start');
	Bun.gc(true);
	for (let i = 0; i < ALLOC_OPS; i++) await instance.fetch(make());
	Bun.gc(true);
	console.error('@@end');
	await instance.dispose();
}

/** In the parent: the JS heap bytes one request allocates, from the child's GC log. */
async function bytesPerRequest(name: string): Promise<number> {
	const child = Bun.spawn(
		[
			process.execPath,
			import.meta.path,
			'--alloc',
			name,
			...(quick ? ['--quick'] : []),
		],
		{ env: { ...process.env, BUN_JSC_logGC: '1' }, stderr: 'pipe' },
	);
	const log = await new Response(child.stderr).text();
	if ((await child.exited) !== 0) throw new Error(`alloc child failed: ${log}`);
	const lines = log.slice(log.indexOf('@@start'), log.indexOf('@@end'));
	let kb = 0;
	let first = true;
	for (const line of lines.split('\n')) {
		const match = /START .*?ca=([\d.]+)kb/.exec(line);
		if (!match) continue;
		// The first collection (the `Bun.gc` after the marker) holds the warmup's leftovers.
		if (first) first = false;
		else kb += Number(match[1]);
	}
	return (kb * 1024) / ALLOC_OPS;
}

if (allocOf !== undefined) {
	const scenario = scenarios.find((s) => s.name === allocOf);
	if (!scenario) throw new Error(`no scenario ${allocOf}`);
	await allocChild(scenario);
	process.exit(0);
}

const rows: Record<string, Record<string, number>> = {};
let requestOnly = 0;
for (const scenario of scenarios) {
	const instance = scenario.make();
	await check(instance.fetch);
	for (let i = 0; i < WARMUP; i++) await instance.fetch(make());
	const rps = await throughput(instance.fetch);
	await instance.dispose();
	const bytes = await bytesPerRequest(scenario.name);
	if (scenario.name === 'request only') requestOnly = bytes;
	rows[scenario.name] = {
		'req/s': Math.round(rps),
		'µs/req': Number((1e6 / rps).toFixed(2)),
		'heap bytes/req': Math.round(bytes),
		'minus Request': Math.round(bytes - requestOnly),
	};
}
console.log(
	`bun ${Bun.version}, ${OPS} ops x ${RUNS} runs (median), ${ALLOC_OPS} ops for bytes`,
);
console.table(rows);
