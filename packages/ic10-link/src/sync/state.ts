/**
 * What was last the same on both sides, per chip: the text (as a hash) the chip and its script
 * last both had. Against it, a pass tells which side changed since. Kept in the project's
 * `.ic10-link/`, which isn't committed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const STATE_DIR = ".ic10-link";

/** Station → chip id → hash of the text both sides last had. */
export type SyncState = Record<string, Record<string, string>>;

export function stateFile(root: string): string {
	return join(root, STATE_DIR, "state.json");
}

export function loadState(root: string): SyncState {
	const file = stateFile(root);
	return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

export function saveState(root: string, state: SyncState): void {
	const file = stateFile(root);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(state, null, "\t")}\n`);
}

/** A short hash of a script's text (as `gameText` gives it). */
export function textHash(text: string): string {
	return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
