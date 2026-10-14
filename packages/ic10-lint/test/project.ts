/** A small project on disk, for the config, lintProject and CLI tests. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { code } from "./helpers.ts";

export interface Project {
	root: string;
	remove(): void;
}

/** Files by path relative to the project; objects are written as JSON. */
export function makeProject(files: Record<string, string | object>): Project {
	const root = mkdtempSync(join(tmpdir(), "ic10-lint-"));
	for (const [path, content] of Object.entries(files)) {
		const full = join(root, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
	}
	return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

/** The fixture: a clean script, one with a warning, one over the line limit with an override, and two stale overrides. */
export const FIXTURE = {
	"ic10/clean.ic10": "start:\nyield\nj start",
	"ic10/rooms/warns.ic10": "alias Sensor d0\nstart:\nyield\nj start",
	"ic10/big.ic10": code(140),
	"ic10/shrunk.ic10": code(10),
	"ic10-lint.json": {
		dir: "ic10",
		rules: { "absolute-jump-number": "off" },
		overrides: {
			"ic10/big.ic10": { reason: "over the limit in the save; don't trim unprompted", limits: { lines: 140 } },
			"ic10/shrunk.ic10": { reason: "was big", limits: { lines: 140 } },
			"ic10/gone.ic10": { reason: "deleted since", limits: { bytes: 5000 } },
		},
	},
};
