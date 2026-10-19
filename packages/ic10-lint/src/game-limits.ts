/** The chip editor's limits, and a project's allowance over one; see limits.ts for how they're counted. */

export const GAME_LIMITS = { lines: 128, columns: 90, bytes: 4096 } as const;

export type LimitName = keyof typeof GAME_LIMITS;

/** A project's allowance for one script that's over a limit: it may stay that size, but not grow. */
export interface LimitOverride {
	reason: string;
	limits?: Partial<Record<LimitName, number>>;
}
