/** Whether npm's registry knows the package (never true for an @graxia one: those come from sibling tarballs). A network failure answers no. */
export async function onRegistry(name: string): Promise<boolean> {
	const res = await fetch(
		`https://registry.npmjs.org/${name.replace('/', '%2F')}`,
		{ method: 'HEAD' },
	).catch(() => null);
	return res?.ok ?? false;
}
