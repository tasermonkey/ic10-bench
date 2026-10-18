/** A project and a chipdata folder on disk, for the tests. */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface Folder {
	root: string;
	remove(): void;
}

/** Files by path relative to the folder; objects are written as JSON. */
export function makeFolder(files: Record<string, string | object>): Folder {
	const root = mkdtempSync(join(tmpdir(), "ic10-link-"));
	for (const [path, content] of Object.entries(files)) {
		const full = join(root, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
	}
	return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

/** Sets a file's or folder's modified time, `secondsAgo` before now. */
export function touch(path: string, secondsAgo: number): void {
	const when = new Date(Date.now() - secondsAgo * 1000);
	utimesSync(path, when, when);
}
