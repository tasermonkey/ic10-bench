import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { lintFiles, lintProject } from "../src/files.ts";
import { FIXTURE, makeProject, type Project } from "./project.ts";

let project: Project;
beforeAll(() => {
	project = makeProject(FIXTURE);
});
afterAll(() => project.remove());

const summary = async () =>
	Object.fromEntries(
		(await lintProject(loadConfig(project.root))).map((r) => [
			r.path,
			r.findings.filter((f) => f.rule !== "batch-ops").map((f) => `${f.severity} ${f.rule}: ${f.message}`),
		]),
	);

describe("loadConfig", () => {
	it("reads the dir, rules and overrides, with override paths relative to the project", () => {
		const config = loadConfig(project.root);
		expect(config.dir).toBe(join(project.root, "ic10"));
		expect(config.rules).toEqual({ "absolute-jump-number": "off" });
		expect(Object.keys(config.overrides)).toEqual(["ic10/big.ic10", "ic10/shrunk.ic10", "ic10/gone.ic10"]);
	});

	it("defaults to ic10/ and the rules' own severities without a config file", () => {
		const bare = makeProject({ "ic10/a.ic10": "yield" });
		try {
			expect(loadConfig(bare.root)).toEqual({ root: bare.root, dir: join(bare.root, "ic10"), rules: {}, overrides: {} });
		} finally {
			bare.remove();
		}
	});

	it("rejects an override without a reason, a limit the game doesn't have, or one under the game's", () => {
		for (const [override, message] of [
			[{ limits: { lines: 140 } }, /needs a "reason"/],
			[{ reason: "x", limits: { width: 100 } }, /the limits are lines, columns and bytes/],
			[{ reason: "x", limits: { lines: 100 } }, /over the game's 128/],
		] as const) {
			const bad = makeProject({ "ic10-lint.json": { overrides: { "ic10/a.ic10": override } } });
			try {
				expect(() => loadConfig(bad.root)).toThrow(message);
			} finally {
				bad.remove();
			}
		}
	});

	it("rejects a severity it doesn't know", () => {
		const bad = makeProject({ "ic10-lint.json": { rules: { unused: "loud" } } });
		try {
			expect(() => loadConfig(bad.root)).toThrow(/rules"\.unused must be one of error, warn, info, off/);
		} finally {
			bad.remove();
		}
	});
});

describe("lintProject", () => {
	it("applies the config's rules and overrides, and reports stale overrides", async () => {
		expect(await summary()).toEqual({
			"ic10/big.ic10": [expect.stringMatching(/^info max-lines: 140 lines; .*\(allowed by an override: over the limit in the save/)],
			"ic10/clean.ic10": [],
			"ic10/rooms/warns.ic10": ["warning unused: alias Sensor is never used"],
			"ic10/shrunk.ic10": ["error max-lines: the override allowing 140 lines is no longer needed (now 10); remove it"],
			"ic10/gone.ic10": ["error config: the override is for a script that doesn't exist; remove it"],
		});
	});

	it('skips node_modules and dot-folders, so "dir": "." doesn\'t search installed packages', async () => {
		const flat = makeProject({
			"top.ic10": "yield",
			"archive/old.ic10": "yield",
			"node_modules/pkg/fixture.ic10": "yield",
			".git/stray.ic10": "yield",
			"ic10-lint.json": { dir: "." },
		});
		try {
			expect((await lintProject(loadConfig(flat.root))).map((r) => r.path)).toEqual(["archive/old.ic10", "top.ic10"]);
		} finally {
			flat.remove();
		}
	});

	it("lints just the files asked for with lintFiles", async () => {
		const reports = await lintFiles(["ic10/rooms"], loadConfig(project.root));
		expect(reports.map((r) => r.path)).toEqual(["ic10/rooms/warns.ic10"]);
	});
});
