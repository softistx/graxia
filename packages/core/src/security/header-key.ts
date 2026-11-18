/** @internal Where an instance exposes the CSRF header the test client should send on a GET. */
export const csrfHeaderKey = Symbol.for('graxia.csrfHeader');

/** @internal Records on `graxia` the CSRF header the test client sends on a GET (none when CSRF is off). */
export function exposeCsrfHeader(
	graxia: object,
	csrf: false | { headers: false | readonly string[] },
): void {
	Object.defineProperty(graxia, csrfHeaderKey, {
		value: csrf === false || !csrf.headers ? undefined : csrf.headers[0],
	});
}
