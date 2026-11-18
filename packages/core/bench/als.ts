/**
 * Overhead of `asyncContext` (AsyncLocalStorage around each operation):
 * `graxia.fetch` throughput on a trivial query, on vs off.
 *
 * Run: bun run packages/core/bench/als.ts
 * Not shipped: `files` and `tsconfig.build.json` only cover `dist` and `src`.
 */
import { createGraxia, createSchema } from '../src';

const schema = createSchema()({
	typeDefs: 'type Query { hello: String }',
	resolvers: { Query: { hello: () => 'world' } },
});
const body = JSON.stringify({ query: '{ hello }' });
const make = () =>
	new Request('http://localhost/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body,
	});

const WARMUP = 5_000;
const OPS = 20_000;
const RUNS = 7;

async function opsPerSecond(asyncContext: boolean): Promise<number[]> {
	const graxia = createGraxia({ schema, asyncContext });
	for (let i = 0; i < WARMUP; i++) await graxia.fetch(make());
	const runs: number[] = [];
	for (let r = 0; r < RUNS; r++) {
		const start = performance.now();
		for (let i = 0; i < OPS; i++) await graxia.fetch(make());
		runs.push(OPS / ((performance.now() - start) / 1000));
	}
	await graxia.dispose();
	return runs;
}

const median = (xs: number[]) =>
	[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

// Interleave to spread machine noise: off, on, off, on.
const off1 = await opsPerSecond(false);
const on1 = await opsPerSecond(true);
const off2 = await opsPerSecond(false);
const on2 = await opsPerSecond(true);
const off = median([...off1, ...off2]);
const on = median([...on1, ...on2]);
console.table({
	'asyncContext: false': { 'median ops/s': Math.round(off) },
	'asyncContext: true': { 'median ops/s': Math.round(on) },
});
console.log(`overhead: ${(((off - on) / off) * 100).toFixed(1)} %`);
