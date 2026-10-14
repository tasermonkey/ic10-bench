import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.ts";
import { loadConfig } from "../src/config.ts";
import { lintProject } from "../src/files.ts";
import { INIT_REASON, SCHEMA_URL, schemaFor } from "../src/init.ts";
import { RULES } from "../src/rules/index.ts";
import { code } from "./helpers.ts";
import { makeProject, type Project } from "./project.ts";

let project: Project | undefined;
afterEach(() => project?.remove());

async function run(...argv: string[]) {
	let output = "";
	const code = await runCli(argv, { cwd: project!.root, out: (text) => (output += `${text}\n`) });
	return { code, output };
}

const written = (file = "ic10-lint.json") => JSON.parse(readFileSync(join(project!.root, file), "utf8"));

describe("ic10-lint init", () => {
	it("writes every rule at its default severity, and overrides for the scripts over a limit", async () => {
		project = makeProject({
			"ic10/clean.ic10": "start:\nyield\nj start",
			"ic10/rooms/big.ic10": code(140),
			"ic10/wide.ic10": `define X ${"1".repeat(95)}\nyield`,
		});
		const { code: exit, output } = await run("init");
		expect(exit).toBe(0);
		expect(output).toContain("ic10/rooms/big.ic10: lines 140");
		expect(output).toContain("ic10/wide.ic10: columns 104");

		const config = written();
		expect(config.dir).toBe("ic10");
		expect(Object.keys(config.rules)).toEqual(RULES.map((r) => r.id));
		expect(config.rules).toMatchObject({ "max-lines": "error", unused: "warn", "register-flow": "off" });
		expect(config.overrides).toEqual({
			"ic10/rooms/big.ic10": { reason: INIT_REASON, limits: { lines: 140 } },
			"ic10/wide.ic10": { reason: INIT_REASON, limits: { columns: 104 } },
		});
	});

	it("leaves the project with no errors from the limit rules, and no stale overrides", async () => {
		project = makeProject({ "ic10/big.ic10": code(140), "ic10/ok.ic10": "yield" });
		await run("init");
		const findings = (await lintProject(loadConfig(project.root))).flatMap((r) => r.findings);
		expect(findings.filter((f) => f.severity === "error")).toEqual([]);
	});

	it("changes no finding's severity by naming the rules' defaults", async () => {
		project = makeProject({
			"ic10/comments.ic10": `move r0 1 # ${"x".repeat(90)}\n${code(127)}\n# past the end`,
			"ic10/names.ic10": 'define A HASH("StructureActivVent")\ndefine B HASH("5")\nyield',
		});
		const severities = async () =>
			(await lintProject(loadConfig(project!.root))).flatMap((r) => r.findings.map((f) => `${r.path} ${f.rule} ${f.severity} ${f.message}`));
		const before = await severities();
		expect(before.filter((f) => / max-(lines|columns) warning /.test(f))).toHaveLength(2);
		await run("init");
		expect(written().overrides).toEqual({});
		expect(await severities()).toEqual(before);
	});

	it("won't replace a config unless --force", async () => {
		project = makeProject({ "ic10-lint.json": { dir: "scripts" }, "scripts/a.ic10": "yield" });
		const refused = await run("init");
		expect(refused.code).toBe(2);
		expect(refused.output).toContain("already exists (--force replaces it)");
		expect(written().dir).toBe("scripts");

		expect((await run("init", "--dir", "scripts", "--force")).code).toBe(0);
		expect(written()).toMatchObject({ dir: "scripts", overrides: {} });
	});

	it("writes to --config, with paths relative to its folder", async () => {
		project = makeProject({ "game/ic10/big.ic10": code(130) });
		expect((await run("init", "--config", "game/lint.json")).code).toBe(0);
		expect(Object.keys(written("game/lint.json").overrides)).toEqual(["ic10/big.ic10"]);
	});

	it("writes a config even before there's a scripts folder", async () => {
		project = makeProject({});
		const { code: exit, output } = await run("init");
		expect(exit).toBe(0);
		expect(output).toContain("No script is over the game's limits.");
		expect(written().overrides).toEqual({});
	});

	it("points $schema at the installed package's schema.json, else the published one", async () => {
		project = makeProject({ "node_modules/@tasermonkey/ic10-lint/schema.json": {}, "game/x.txt": "" });
		await run("init");
		expect(written().$schema).toBe("./node_modules/@tasermonkey/ic10-lint/schema.json");
		await run("init", "--config", "game/ic10-lint.json");
		expect(written("game/ic10-lint.json").$schema).toBe("../node_modules/@tasermonkey/ic10-lint/schema.json");
		expect(schemaFor(tmpdir())).toBe(SCHEMA_URL);
	});

	it("writes a config that loadConfig reads as it is", async () => {
		project = makeProject({ "ic10/big.ic10": code(140) });
		await run("init");
		expect(loadConfig(project.root).overrides).toEqual({ "ic10/big.ic10": { reason: INIT_REASON, limits: { lines: 140 }, rules: {} } });
	});

	it("exits 2 for an option init doesn't take", async () => {
		project = makeProject({});
		expect((await run("init", "--format", "json")).code).toBe(2);
		expect((await run("init", "--dir")).code).toBe(2);
	});
});
