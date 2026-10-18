import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CliIo, runCli } from "../src/cli.ts";
import { type Folder, makeFolder, touch } from "./project.ts";

const folders: Folder[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) folder.remove();
});

async function run(project: Folder, ...argv: string[]) {
	return runWith(project, {}, ...argv);
}

async function runWith(project: Folder, io: Partial<CliIo>, ...argv: string[]) {
	let output = "";
	const code = await runCli(argv, { cwd: project.root, out: (text) => (output += `${text}\n`), env: {}, documents: () => undefined, ...io });
	return { code, output };
}

/** Answers each question in turn, and keeps the questions. */
function answers(...replies: string[]) {
	const questions: string[] = [];
	return { questions, ask: async (question: string) => (questions.push(question), replies.shift() ?? "") };
}

function setup(chips: Record<string, string> = {}) {
	const chipdata = makeFolder({
		"Base/Script1 [450].ic10": "start:\nyield\nj start",
		"Base/Lights [451].ic10": "yield",
		"Base/Integrated Circuit (IC10) [448].ic10": "",
		...Object.fromEntries(Object.entries(chips).map(([name, text]) => [`Base/${name}`, text])),
	});
	const project = makeFolder({ "ic10/lights.ic10": "yield", "stations/Base.json": { chips: { "451": "ic10/lights.ic10" } } });
	folders.push(chipdata, project);
	return { chipdata, project };
}

describe("ic10-link status", () => {
	it("lists the mapped chips, the unmapped ones with code, and the empty ones", async () => {
		const { chipdata, project } = setup();
		const { code, output } = await run(project, "status", "--chipdata", chipdata.root);
		expect(code).toBe(0);
		expect(output).toContain("Station: Base\n");
		expect(output).toContain("  map:   stations/Base.json\n");
		expect(output).toContain("Mapped:\n  [451] Lights -> ic10/lights.ic10: same\n");
		expect(output).toContain("Not mapped:\n  [450] Script1: 3 lines\n");
		expect(output).toContain("Empty, not mapped: [448] Integrated Circuit (IC10)\n");
	});

	it("says when the station has no map yet", async () => {
		const { chipdata } = setup();
		const empty = makeFolder({});
		folders.push(empty);
		const { output } = await run(empty, "status", "--chipdata", chipdata.root);
		expect(output).toContain("  map:   stations/Base.json (none yet)\n");
	});

	it("exits 2 for a missing chipdata folder, an unknown station, option or command", async () => {
		const { chipdata, project } = setup();
		expect((await run(project, "status", "--chipdata", "nowhere")).code).toBe(2);
		expect((await run(project, "status", "--chipdata", chipdata.root, "--station", "Gone")).output).toContain('no station "Gone"');
		expect((await run(project, "status", "--nope", "1")).output).toContain("unknown option '--nope'");
		expect((await run(project, "frobnicate")).code).toBe(2);
		expect((await run(project)).code).toBe(2);
	});

	it("prints the usage for --help", async () => {
		const { project } = setup();
		const { code, output } = await run(project, "--help");
		expect(code).toBe(0);
		expect(output).toContain("Usage: ic10-link <command> [options]");
		expect(output).toContain("A station's map, stations/<station>.json");
		const once = await run(project, "once", "--help");
		expect(once.code).toBe(0);
		expect(once.output).toContain("Usage: ic10-link once [options]");
		expect(once.output).toContain("--no-tests");
		expect(once.output).toContain("--chipdata <folder>");
	});
});

describe("ic10-link map, adopt and unmap", () => {
	const mapOf = (project: Folder) => JSON.parse(readFileSync(join(project.root, "stations", "Base.json"), "utf8"));

	it("map adds a chip to the station's map, tab-indented, in id order", async () => {
		const { chipdata, project } = setup();
		const { code, output } = await run(project, "map", "[450]", "ic10/lights.ic10", "--chipdata", chipdata.root);
		expect(code).toBe(0);
		expect(output).toBe("Mapped [450] Script1 -> ic10/lights.ic10\n");
		expect(readFileSync(join(project.root, "stations", "Base.json"), "utf8")).toBe(
			'{\n\t"chips": {\n\t\t"450": "ic10/lights.ic10",\n\t\t"451": "ic10/lights.ic10"\n\t}\n}\n',
		);
	});

	it("map says what the chip ran before, and when the game has no file for it yet", async () => {
		const { chipdata, project } = setup();
		writeFileSync(join(project.root, "ic10", "other.ic10"), "yield");
		expect((await run(project, "map", "451", "ic10/other.ic10", "--chipdata", chipdata.root)).output).toBe(
			"Mapped [451] Lights -> ic10/other.ic10 (was ic10/lights.ic10)\n",
		);
		expect((await run(project, "map", "999", "ic10/other.ic10", "--chipdata", chipdata.root)).output).toContain(
			"The game has no file for chip 999 yet.",
		);
		expect(mapOf(project).chips).toEqual({ "451": "ic10/other.ic10", "999": "ic10/other.ic10" });
	});

	it("map keeps a chip's other settings, and writes the chips that have only a script as just its path", async () => {
		const { chipdata, project } = setup();
		writeFileSync(join(project.root, "ic10", "other.ic10"), "yield");
		writeFileSync(
			join(project.root, "stations", "Base.json"),
			JSON.stringify({ chips: { "450": { script: "ic10/lights.ic10", note: "kept" }, "451": { script: "ic10/lights.ic10" } } }),
		);
		await run(project, "map", "450", "ic10/other.ic10", "--chipdata", chipdata.root);
		expect(mapOf(project).chips).toEqual({ "450": { script: "ic10/other.ic10", note: "kept" }, "451": "ic10/lights.ic10" });
	});

	it("map refuses a script the project doesn't have, or one outside it", async () => {
		const { chipdata, project } = setup();
		const missing = await run(project, "map", "450", "ic10/new.ic10", "--chipdata", chipdata.root);
		expect(missing.code).toBe(2);
		expect(missing.output).toContain("ic10/new.ic10: no such script. To copy the chip's code from the game into it, use adopt.");
		expect((await run(project, "map", "450", "../elsewhere.ic10", "--chipdata", chipdata.root)).output).toContain("not in the project");
		expect((await run(project, "map", "450", "ic10/lights.txt", "--chipdata", chipdata.root)).output).toContain("not a .ic10 file");
		expect((await run(project, "map", "Script1", "ic10/lights.ic10", "--chipdata", chipdata.root)).output).toContain("Script1: not a chip id");
		expect(mapOf(project).chips).toEqual({ "451": "ic10/lights.ic10" });
	});

	it("adopt copies the chip's code into a new script, as the game keeps it, and maps it", async () => {
		const { chipdata, project } = setup({ "Air [452].ic10": "start:  \r\n\tyield\r\nj start\r\n" });
		const { code, output } = await run(project, "adopt", "452", "ic10/Climate/Air.ic10", "--chipdata", chipdata.root);
		expect(code).toBe(0);
		expect(output).toBe("Copied [452] Air's code to ic10/Climate/Air.ic10 (3 lines)\nMapped [452] Air -> ic10/Climate/Air.ic10\n");
		expect(readFileSync(join(project.root, "ic10", "Climate", "Air.ic10"), "utf8")).toBe("start:\n yield\nj start\n");
		expect(mapOf(project).chips["452"]).toBe("ic10/Climate/Air.ic10");
		expect((await run(project, "status", "--chipdata", chipdata.root)).output).toContain("[452] Air -> ic10/Climate/Air.ic10: same\n");
	});

	it("adopt won't overwrite a script, or guess between a relabelled chip's files", async () => {
		const { chipdata, project } = setup({ "Room Lights [451].ic10": "yield" });
		const exists = await run(project, "adopt", "450", "ic10/lights.ic10", "--chipdata", chipdata.root);
		expect(exists.code).toBe(2);
		expect(exists.output).toContain("ic10/lights.ic10 already exists. To have the chip run it as it is, use map.");
		expect((await run(project, "adopt", "451", "ic10/new.ic10", "--chipdata", chipdata.root)).output).toContain(
			"Chip [451] has 2 files. Run ic10-link status to choose the current one.",
		);
		expect((await run(project, "adopt", "999", "ic10/new.ic10", "--chipdata", chipdata.root)).output).toContain("No chip [999] in Base.");
		expect(existsSync(join(project.root, "ic10", "new.ic10"))).toBe(false);
	});

	it("unmap takes a chip out of the map, and leaves its script", async () => {
		const { chipdata, project } = setup();
		expect((await run(project, "unmap", "451", "--chipdata", chipdata.root)).output).toBe("Unmapped [451] (was ic10/lights.ic10)\n");
		expect(mapOf(project).chips).toEqual({});
		expect(existsSync(join(project.root, "ic10", "lights.ic10"))).toBe(true);
		const again = await run(project, "unmap", "451", "--chipdata", chipdata.root);
		expect(again.code).toBe(2);
		expect(again.output).toContain("Chip [451] isn't mapped in Base.");
	});

	it("exits 2 for the wrong number of arguments", async () => {
		const { chipdata, project } = setup();
		expect((await run(project, "map", "450", "--chipdata", chipdata.root)).output).toContain("missing required argument 'script'");
		expect((await run(project, "unmap", "--chipdata", chipdata.root)).output).toContain("missing required argument 'id'");
		expect((await run(project, "status", "extra", "--chipdata", chipdata.root)).code).toBe(2);
	});
});

describe("ic10-link once", () => {
	const noTests = { findTests: async () => [] };

	it("sends changed scripts to their chips, and exits 0", async () => {
		const { chipdata, project } = setup();
		writeFileSync(join(project.root, "ic10", "lights.ic10"), "sleep 1");
		const { code, output } = await runWith(project, noTests, "once", "--chipdata", chipdata.root);
		expect(code).toBe(0);
		expect(output).toContain("ic10/lights.ic10 -> Base/[451] Lights (lint ok; no tests name this script)\n");
		expect(readFileSync(join(chipdata.root, "Base", "Lights [451].ic10"), "utf8")).toBe("sleep 1");
	});

	it("exits 1 when a script fails its checks", async () => {
		const { chipdata, project } = setup();
		writeFileSync(join(project.root, "ic10", "lights.ic10"), Array.from({ length: 130 }, () => "yield").join("\n"));
		const { code, output } = await runWith(project, noTests, "once", "--chipdata", chipdata.root);
		expect(code).toBe(1);
		expect(output).toContain("[451] Lights: not sent, ic10/lights.ic10 failed its checks:");
	});

	it("copies a chip edited in game to its script, and exits 1 when that fails its checks", async () => {
		const { chipdata, project } = setup();
		await runWith(project, noTests, "once", "--chipdata", chipdata.root);
		const tooLong = Array.from({ length: 130 }, () => "yield").join("\n");
		writeFileSync(join(chipdata.root, "Base", "Lights [451].ic10"), tooLong);
		const { code, output } = await runWith(project, noTests, "once", "--chipdata", chipdata.root);
		expect(code).toBe(1);
		expect(output).toContain("Base/[451] Lights -> ic10/lights.ic10 (edited in game), and it fails its checks:");
		expect(readFileSync(join(project.root, "ic10", "lights.ic10"), "utf8")).toBe(`${tooLong}\n`);
	});

	it("passes --no-tests on, and says when nothing is mapped", async () => {
		const { chipdata, project } = setup();
		writeFileSync(join(project.root, "ic10", "lights.ic10"), "sleep 1");
		const findTests = async () => {
			throw new Error("not to be called");
		};
		expect((await runWith(project, { findTests }, "once", "--no-tests", "--chipdata", chipdata.root)).output).toContain("tests not run (--no-tests)");
		expect((await run(project, "status", "--no-tests", "--chipdata", chipdata.root)).output).toContain("unknown option '--no-tests'");

		writeFileSync(join(project.root, "stations", "Base.json"), '{ "chips": {} }');
		expect((await run(project, "once", "--chipdata", chipdata.root)).output).toContain("No chips mapped in Base yet");
	});
});

describe("ic10-link status, for a relabelled chip", () => {
	/** Chip 451 relabelled: "Lights" first, "Room Lights" since. */
	function relabelled() {
		const folders = setup({ "Room Lights [451].ic10": "yield\nyield" });
		touch(join(folders.chipdata.root, "Base", "Lights [451].ic10"), 3600);
		return folders;
	}

	it("lists the chip's files and exits 1, when there's no one to ask", async () => {
		const { chipdata, project } = relabelled();
		const { code, output } = await run(project, "status", "--chipdata", chipdata.root);
		expect(code).toBe(1);
		expect(output).toContain("[451] ? -> ic10/lights.ic10: several files\n");
		expect(output).toContain("Several files for one chip.");
		expect(output).toMatch(/ {4}Lights \[451\]\.ic10 {7}modified \S+ \S+, 1 line\n/);
		expect(output).toMatch(/ {4}Room Lights \[451\]\.ic10 {2}modified \S+ \S+, 2 lines\n/);
		expect(existsSync(join(chipdata.root, "Base", "Lights [451].ic10"))).toBe(true);
	});

	it("asks which file is current, oldest first, and deletes the others", async () => {
		const { chipdata, project } = relabelled();
		const { questions, ask } = answers("2");
		const { code, output } = await runWith(project, { ask }, "status", "--chipdata", chipdata.root);
		expect(code).toBe(0);
		expect(questions).toEqual(["Which one is current? The others are deleted. [1-2, Enter to skip]: "]);
		expect(output).toContain("Chip 451 has 2 files.");
		expect(output).toMatch(/1\) Lights \[451\]\.ic10 .*\n.*2\) Room Lights \[451\]\.ic10/);
		expect(output).toContain("  deleted Lights [451].ic10\n");
		expect(output).toContain("[451] Room Lights -> ic10/lights.ic10: differs\n");
		expect(existsSync(join(chipdata.root, "Base", "Lights [451].ic10"))).toBe(false);
		expect(existsSync(join(chipdata.root, "Base", "Room Lights [451].ic10"))).toBe(true);
	});

	it("asks again after an answer that isn't one of the files", async () => {
		const { chipdata, project } = relabelled();
		const { questions, ask } = answers("3", "x", "1");
		const { code } = await runWith(project, { ask }, "status", "--chipdata", chipdata.root);
		expect(code).toBe(0);
		expect(questions).toHaveLength(3);
		expect(existsSync(join(chipdata.root, "Base", "Room Lights [451].ic10"))).toBe(false);
	});

	it("keeps every file when the player skips the chip", async () => {
		const { chipdata, project } = relabelled();
		const { code, output } = await runWith(project, answers(""), "status", "--chipdata", chipdata.root);
		expect(code).toBe(1);
		expect(output).toContain("Several files for one chip.");
		expect(existsSync(join(chipdata.root, "Base", "Lights [451].ic10"))).toBe(true);
	});
});
