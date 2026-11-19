import type { Role } from './generated';

/** What the fixture's resolvers return for `User` (a mapper). */
export type UserRow = { id: string; name: string; role: Role; at: number };
