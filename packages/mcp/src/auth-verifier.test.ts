import { describe, expect, test } from 'bun:test';
import { mcpFor, rpc } from './fixtures.test-util';
import type { McpAuthInfo, McpAuthOptions } from './index';

const RESOURCE = 'https://api.example.com/mcp';
const errors: unknown[] = [];

/** An endpoint whose verifier answers `answer`, whatever the token. */
function verifying(
	answer: unknown,
	auth: Partial<McpAuthOptions> = {},
	allowedOrigins: string[] = [],
) {
	errors.length = 0;
	return mcpFor({
		allowedOrigins,
		onError: (error) => void errors.push(error),
		auth: {
			resource: RESOURCE,
			authorizationServers: ['https://auth.example.com'],
			verifyToken: () => answer as McpAuthInfo,
			...auth,
		},
	}).mcp;
}
const list = (headers: HeadersInit = {}) =>
	rpc('tools/list', {}, { authorization: 'Bearer t', ...headers });
const refused = async (response: Response) => {
	const body = await response.json();
	return {
		status: response.status,
		challenge: response.headers.get('www-authenticate') ?? '',
		message: body.error.message as string,
		fix: body.error.data.fix as string,
	};
};

describe('a verifier that resolves a Response', () => {
	const own = () =>
		Response.json(
			{ error: 'invalid_token' },
			{ status: 401, headers: { 'www-authenticate': 'Bearer error="x"' } },
		);
	test('it is the answer, as is', async () => {
		const response = await verifying(own()).fetch(list());
		expect(response.status).toBe(401);
		expect(response.headers.get('www-authenticate')).toBe('Bearer error="x"');
		expect(await response.json()).toEqual({ error: 'invalid_token' });
		expect(errors).toEqual([]);
	});
	test('an allowed origin gets the CORS headers on it', async () => {
		const mcp = verifying(own(), {}, ['https://app.example']);
		const response = await mcp.fetch(list({ origin: 'https://app.example' }));
		expect(response.status).toBe(401);
		expect(response.headers.get('access-control-allow-origin')).toBe(
			'https://app.example',
		);
		expect(response.headers.get('access-control-expose-headers')).toContain(
			'www-authenticate',
		);
		expect(await response.json()).toEqual({ error: 'invalid_token' });
	});
});

describe('what the verifier returns is checked', () => {
	test('no scopes array: 401 and onError, not a 500', async () => {
		const response = await verifying({ audience: RESOURCE }).fetch(list());
		const { status, challenge } = await refused(response);
		expect(status).toBe(401);
		expect(challenge).toContain('error="invalid_token"');
		expect(String(errors[0])).toContain('verifyToken must return scopes');
	});
	test('null (a JavaScript verifier): 401, not a 500', async () => {
		const { status, message } = await refused(
			await verifying(null).fetch(list()),
		);
		expect(status).toBe(401);
		expect(message).toBe('Unauthorized: the access token is invalid.');
	});
	test.each([
		['milliseconds', Date.now() + 3_600_000],
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
		['a string', '1900000000'],
	])(
		'expiresAt as %s: 401 invalid_token and onError',
		async (_name, expiresAt) => {
			const mcp = verifying({
				scopes: ['mcp:read'],
				audience: RESOURCE,
				expiresAt,
			});
			const { status, challenge, message } = await refused(
				await mcp.fetch(list()),
			);
			expect(status).toBe(401);
			expect(challenge).toContain('error="invalid_token"');
			expect(message).toContain('expiresAt is in seconds');
			expect(String(errors[0])).toContain('expiresAt is in seconds');
		},
	);
	test('expiresAt is optional, and a future value in seconds passes', async () => {
		const info = { scopes: ['mcp:read'], audience: RESOURCE };
		expect((await verifying(info).fetch(list())).status).toBe(200);
		const expiresAt = Math.floor(Date.now() / 1000) + 60;
		expect((await verifying({ ...info, expiresAt }).fetch(list())).status).toBe(
			200,
		);
		expect(errors).toEqual([]);
	});
});

describe('the audience', () => {
	const info = { scopes: ['mcp:read'] };
	test('none returned: 401 invalid_token with a fix', async () => {
		const { status, challenge, message, fix } = await refused(
			await verifying(info).fetch(list()),
		);
		expect(status).toBe(401);
		expect(challenge).toContain('error="invalid_token"');
		expect(message).toBe('Unauthorized: the access token carries no audience.');
		expect(fix).toContain(RESOURCE);
		expect(fix).toContain("auth.audience to 'verifier'");
	});
	test("audience: 'verifier' accepts a token without one", async () => {
		const mcp = verifying(info, { audience: 'verifier' });
		expect((await mcp.fetch(list())).status).toBe(200);
	});
	test("audience: 'verifier' does not compare a returned audience", async () => {
		const mcp = verifying(
			{ ...info, audience: 'client-id' },
			{ audience: 'verifier' },
		);
		expect((await mcp.fetch(list())).status).toBe(200);
	});
	test("audience: 'resource' is the default", async () => {
		const mcp = verifying(
			{ ...info, audience: 'https://other.example.com/mcp' },
			{ audience: 'resource' },
		);
		const { status, message } = await refused(await mcp.fetch(list()));
		expect(status).toBe(401);
		expect(message).toContain('was issued for another resource');
	});
});
