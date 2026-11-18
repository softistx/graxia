import { expect, test } from 'bun:test';
import { raw, start } from '../ws/ws.test-util';

test('a subscribe message by documentId runs a manifest document', async () => {
	const { url } = start({
		trustedDocuments: { manifest: { h: '{ hello }' }, mode: 'strict' },
	});
	const ws = raw(url);
	await ws.init();
	await ws.send({ id: '1', type: 'subscribe', payload: { documentId: 'h' } });
	expect(await ws.next()).toMatchObject({
		type: 'next',
		payload: { data: { hello: 'world' } },
	});
	await ws.send({
		id: '2',
		type: 'subscribe',
		payload: { query: '{ hello }' },
	});
	await ws.next(); // complete of the first
	const refused = await ws.next();
	expect(JSON.stringify(refused)).toContain('PERSISTED_QUERY_ONLY');
});
