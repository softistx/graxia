/** The Redis channel (before the prefix) of a topic and its optional id: `topic`, or `topic:id`. */
export function channelOf(topic: string, id: string | number | undefined) {
	return id === undefined ? topic : `${topic}:${id}`;
}

/** Splits publish arguments into the id (when there are two) and the payload. */
export function splitPublishArgs(args: readonly unknown[]): {
	id: string | number | undefined;
	payload: unknown;
} {
	return args.length >= 2
		? { id: args[0] as string | number, payload: args[1] }
		: { id: undefined, payload: args[0] };
}
