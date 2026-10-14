import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stripVTControlCharacters } from "node:util";
import { pathToFileURL } from "node:url";
import { type CliIo, fileLink, runCli, wantsColor } from "../src/cli.ts";
import { CATALOG } from "./helpers.ts";
import { FIXTURE, makeProject, type Project } from "./project.ts";

let project: Project;
beforeAll(() => {
	project = makeProject(FIXTURE);
});
afterAll(() => project.remove());

async function run(...argv: string[]) {
	return runWith({}, ...argv);
}

async function runWith(io: Partial<CliIo>, ...argv: string[]) {
	let output = "";
	const code = await runCli(argv, { cwd: project.root, out: (text) => (output += `${text}\n`), ...io });
	return { code, output };
}

const ESC = "\u001b[";

describe("ic10-lint", () => {
	it("exits 1 when there's an error, listing file:line:col severity rule message (1-based)", async () => {
		const { code, output } = await run();
		expect(code).toBe(1);
		expect(output).toContain("ic10/rooms/warns.ic10:1:7 warning unused alias Sensor is never used");
		expect(output).toContain("ic10/shrunk.ic10:1:1 error max-lines the override allowing 140 lines is no longer needed");
		expect(output).toContain("ic10/gone.ic10:1:1 error config the override is for a script that doesn't exist");
		expect(output).toContain("2 errors, 1 warnings in 5 scripts");
		expect(output).toContain("(batch-ops was skipped: no device catalogue; pass --catalog)");
	});

	it("exits 0 for warnings, unless --fail-on warning", async () => {
		expect((await run("ic10/rooms")).code).toBe(0);
		expect((await run("ic10/rooms", "--fail-on", "warning")).code).toBe(1);
		expect((await run("ic10/clean.ic10", "--fail-on", "warning")).code).toBe(0);
	});

	it("checks batch instructions against --catalog", async () => {
		writeFileSync(join(project.root, "catalog.json"), JSON.stringify(CATALOG));
		writeFileSync(join(project.root, "ic10", "batch.ic10"), 'sb HASH("StructureActiveVent") Charge 1');
		try {
			const { code, output } = await run("ic10/batch.ic10", "--catalog", "catalog.json");
			expect(code).toBe(1);
			expect(output).toContain("ic10/batch.ic10:1:32 error batch-ops StructureActiveVent has no Charge");
		} finally {
			writeFileSync(join(project.root, "ic10", "batch.ic10"), "yield");
		}
	});

	it("prints the findings as JSON with --format json", async () => {
		const { output } = await run("ic10/rooms", "--format", "json");
		expect(JSON.parse(output)).toEqual([
			{
				path: "ic10/rooms/warns.ic10",
				findings: [
					expect.objectContaining({ rule: "batch-ops", severity: "info" }),
					{ rule: "unused", severity: "warning", line: 0, column: 6, message: "alias Sensor is never used", text: "alias Sensor d0" },
				],
			},
		]);
	});

	it("colours the text when asked: the path, the severity, the counts", async () => {
		const { output } = await runWith({ color: true }, "ic10/rooms");
		expect(output).toContain(`${ESC}1m${ESC}36mic10/rooms/warns.ic10${ESC}39m${ESC}22m${ESC}2m:1:7${ESC}22m`);
		expect(output).toContain(`${ESC}33mwarning${ESC}39m`);
		expect(output).toContain(`${ESC}32m0 errors${ESC}39m`);
		const unlinked = (await runWith({ color: true, links: false }, "ic10/rooms")).output;
		expect(stripVTControlCharacters(unlinked)).toBe((await run("ic10/rooms")).output);
	});

	it("links each path to its file and line with colour, unless --no-links", async () => {
		const url = `${pathToFileURL(join(project.root, "ic10", "rooms", "warns.ic10")).href}#1:7`;
		const linked = (await runWith({ color: true }, "ic10/rooms")).output;
		expect(linked).toContain(`\u001b]8;;${url}\u001b\\${ESC}1m${ESC}36mic10/rooms/warns.ic10`);
		expect(linked).toContain(`${ESC}2m:1:7${ESC}22m\u001b]8;;\u001b\\ `);

		const unlinked = (await runWith({ color: true }, "ic10/rooms", "--no-links")).output;
		expect(unlinked).not.toContain("\u001b]8;");
		expect(unlinked).toContain(`${ESC}33mwarning`);
		expect((await run("ic10/rooms")).output).not.toContain("\u001b]8;");
	});

	it("encodes spaces in a link's path", () => {
		const link = fileLink(true, join(project.root, "VC IC - Arc Furnace.ic10"), "x", 7, 7);
		expect(link).toMatch(/^\u001b\]8;;file:\/\/\/.*\/VC%20IC%20-%20Arc%20Furnace\.ic10#7:7\u001b\\x\u001b\]8;;\u001b\\$/);
		expect(fileLink(false, "a.ic10", "x", 1, 1)).toBe("x");
	});

	it("never colours JSON, or text unless asked", async () => {
		expect((await run("ic10/rooms")).output).not.toContain(ESC);
		expect((await runWith({ color: true }, "ic10/rooms", "--format", "json")).output).not.toContain(ESC);
	});

	it("wants colour on a colour terminal, or with FORCE_COLOR, never on a pipe", () => {
		const terminal = (isTTY: boolean, colors: boolean) => ({ isTTY, hasColors: () => colors }) as unknown as NodeJS.WriteStream;
		const force = process.env.FORCE_COLOR;
		try {
			delete process.env.FORCE_COLOR;
			expect(wantsColor(terminal(true, true))).toBe(true);
			expect(wantsColor(terminal(true, false))).toBe(false);
			expect(wantsColor(terminal(false, true))).toBe(false);
			process.env.FORCE_COLOR = "1";
			expect(wantsColor(terminal(false, false))).toBe(true);
			process.env.FORCE_COLOR = "0";
			expect(wantsColor(terminal(true, true))).toBe(false);
		} finally {
			if (force === undefined) delete process.env.FORCE_COLOR;
			else process.env.FORCE_COLOR = force;
		}
	});

	it("exits 2 for a bad option or config, and prints the usage for --help", async () => {
		expect((await run("--fail-on", "info")).code).toBe(2);
		expect((await run("--frobnicate", "x")).code).toBe(2);
		expect((await run("--config", "missing.json")).code).toBe(2);
		const help = await run("--help");
		expect(help.code).toBe(0);
		expect(help.output).toMatch(/max-columns +No line past the game's 90 characters/);
	});

	it("runs as a command, in plain text to a pipe", () => {
		const bin = join(import.meta.dirname, "..", "bin", "ic10-lint.ts");
		let status = 0;
		let stdout = "";
		try {
			const { FORCE_COLOR, ...env } = process.env;
			stdout = execFileSync(process.execPath, ["--conditions=source", bin, "ic10/clean.ic10"], {
				cwd: project.root,
				encoding: "utf8",
				env,
			});
		} catch (error) {
			status = (error as { status: number }).status;
		}
		expect(status).toBe(0);
		expect(stdout).toContain("0 errors, 0 warnings in 1 scripts"); // plain: stdout is a pipe
	});
});
