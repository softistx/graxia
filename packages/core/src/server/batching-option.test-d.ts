import { createGraxia } from './create-graxia';
import { schema } from './fixtures.test-util';

export function types() {
	createGraxia({ schema, batching: true });
	createGraxia({ schema, batching: false });
	createGraxia({ schema, batching: { limit: 5 } });
	// @ts-expect-error a string is not a batching option
	createGraxia({ schema, batching: 'yes' });
}
