import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';
import { createTestClient } from '../testing/client';
import { sha256Hex } from './apq';
import type { TrustedDocumentsOptions } from './types';

export const HELLO = '{ hello }';
export const hash = sha256Hex(HELLO);

export function setup(
	trustedDocuments: TrustedDocumentsOptions,
	extra: { reported?: unknown[] } = {},
) {
	const graxia = createGraxia({
		schema,
		batching: { limit: 5 },
		trustedDocuments,
		onUnexpected: (error) => extra.reported?.push(error),
	});
	return { graxia, client: createTestClient(graxia) };
}

export const codes = (
	errors: readonly { extensions?: unknown }[] | undefined,
) => errors?.map((e) => (e.extensions as { code?: string }).code);
