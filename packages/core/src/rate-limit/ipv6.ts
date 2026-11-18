const FULL = (1n << 128n) - 1n;

/** The 128-bit value of an IPv6 address (zone and dotted IPv4 tail allowed), or `undefined` when it is not one. */
function toBits(address: string): bigint | undefined {
	let text = address;
	const zone = text.indexOf('%');
	if (zone >= 0) text = text.slice(0, zone);
	const dot = text.lastIndexOf('.');
	if (dot >= 0) {
		const colon = text.lastIndexOf(':');
		const octets = text.slice(colon + 1).split('.');
		if (
			octets.length !== 4 ||
			!octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)
		)
			return undefined;
		const [a, b, c, d] = octets.map(Number) as [number, number, number, number];
		text = `${text.slice(0, colon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}
	const halves = text.split('::');
	if (halves.length > 2) return undefined;
	const side = (part: string) => (part === '' ? [] : part.split(':'));
	const head = side(halves[0] as string);
	const tail = halves.length === 2 ? side(halves[1] as string) : [];
	const missing = 8 - head.length - tail.length;
	if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined;
	const groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
	let bits = 0n;
	for (const group of groups) {
		if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined;
		bits = (bits << 16n) | BigInt(Number.parseInt(group, 16));
	}
	return bits;
}

/**
 * Reduces an IPv6 address to its network, `<8 hex groups>/<prefix>`; an IPv4
 * address (or anything that is not IPv6) is returned unchanged. An IPv4-mapped
 * address (`::ffff:a.b.c.d`, or `::ffff:XXXX:XXXX`) becomes plain IPv4.
 */
export function networkOf(address: string, prefix: number): string {
	if (!address.includes(':')) return address;
	const bits = toBits(address);
	if (bits === undefined) return address;
	// An IPv4-mapped address is an IPv4 client: never prefixed.
	if (bits >> 32n === 0xffffn) {
		const v4 = Number(bits & 0xffffffffn);
		return [v4 >>> 24, (v4 >>> 16) & 255, (v4 >>> 8) & 255, v4 & 255].join('.');
	}
	const keep = (FULL << BigInt(128 - prefix)) & FULL;
	const network = bits & keep;
	const groups: string[] = [];
	for (let i = 7; i >= 0; i--)
		groups.push(((network >> BigInt(i * 16)) & 0xffffn).toString(16));
	return `${groups.join(':')}/${prefix}`;
}
