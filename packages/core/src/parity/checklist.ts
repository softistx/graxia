import type { ParityItem } from './item';
import { ITEMS_1_11 } from './items-01-11';
import { ITEMS_12_24 } from './items-12-24';
import { ITEMS_25_35 } from './items-25-35';

export type { ParityItem } from './item';

/** The parity table, in item order. See `item.ts` for what it holds. */
export const PARITY: readonly ParityItem[] = [
	...ITEMS_1_11,
	...ITEMS_12_24,
	...ITEMS_25_35,
];
