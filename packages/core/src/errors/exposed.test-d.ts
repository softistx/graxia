import { exposedError } from './exposed';

// An app's own codes, as a consumer writes them (here against the declaring file).
declare module './codes' {
	interface GraxiaErrorCodes {
		PAYMENT_REQUIRED: true;
	}
}

exposedError('NOT_FOUND', 'Book not found.', { fix: 'Check the id.' });
exposedError('PAYMENT_REQUIRED', 'Pay first.');
// @ts-expect-error an unknown code is refused
exposedError('NOT_A_CODE', 'Nope.');
