import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPattern, type LintConfig, loadConfig, overrideFor } from "../src/config.ts";
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

	it("rejects limits on a pattern, since they're one script's allowance", () => {
		const bad = makeProject({ "ic10-lint.json": { overrides: { "ic10/Audit/**": { reason: "x", limits: { lines: 140 } } } } });
		try {
			expect(() => loadConfig(bad.root)).toThrow(/overrides\["ic10\/Audit\/\*\*"\] is a pattern: limits are for one script/);
		} finally {
			bad.remove();
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

describe("overrideFor", () => {
	const config = (overrides: Record<string, object>) => ({ root: "/p", dir: "/p/ic10", rules: {}, overrides }) as LintConfig;

	it("takes a key with a * as a pattern, and one with brackets as a script's name", () => {
		expect(isPattern("ic10/Audit/**")).toBe(true);
		expect(isPattern("ic10/Air [7335].ic10")).toBe(false);
		const air = { reason: "air" };
		expect(overrideFor(config({ "ic10/Air [7335].ic10": air }), "ic10/Air [7335].ic10")).toBe(air);
		expect(overrideFor(config({ "ic10/Air [7335].ic10": air }), "ic10/Air 7.ic10")).toBeUndefined();
	});

	it("merges the rules of every pattern that matches, in order, then the script's own", () => {
		const overrides = {
			"ic10/**": { reason: "all", rules: { unused: "off", validate: "warn" } },
			"ic10/Audit/*.ic10": { reason: "audits", rules: { validate: "off", idle: "off" } },
			"ic10/Audit/Stack.ic10": { reason: "this one", limits: { lines: 140 }, rules: { idle: "warn" } },
		};
		expect(overrideFor(config(overrides), "ic10/Audit/Stack.ic10")).toEqual({
			reason: "this one",
			limits: { lines: 140 },
			rules: { unused: "off", validate: "off", idle: "warn" },
		});
		expect(overrideFor(config(overrides), "ic10/Audit/Jump.ic10")).toEqual({ reason: "all", rules: { unused: "off", validate: "off", idle: "off" } });
		expect(overrideFor(config(overrides), "ic10/Audit/Deep/Jump.ic10")?.rules).toEqual({ unused: "off", validate: "warn" });
	});
});

describe("lintProject", () => {
	it("applies a pattern's rules to the scripts it matches, and reports one that matches none", async () => {
		const audits = makeProject({
			"ic10/Audit/unused.ic10": "alias Sensor d0\nstart:\nyield\nj start",
			"ic10/other.ic10": "alias Sensor d0\nstart:\nyield\nj start",
			"ic10-lint.json": {
				overrides: {
					"ic10/Audit/**": { reason: "fail on purpose", rules: { unused: "off" } },
					"ic10/Gone/**": { reason: "moved since", rules: { unused: "off" } },
				},
			},
		});
		try {
			const reports = await lintProject(loadConfig(audits.root));
			expect(Object.fromEntries(reports.map((r) => [r.path, r.findings.filter((f) => f.rule !== "batch-ops").map((f) => `${f.rule}: ${f.message}`)]))).toEqual({
				"ic10/Audit/unused.ic10": [],
				"ic10/other.ic10": ["unused: alias Sensor is never used"],
				"ic10/Gone/**": ['config: the override\'s pattern matches no script in "ic10"; remove it'],
			});
		} finally {
			audits.remove();
		}
	});

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
