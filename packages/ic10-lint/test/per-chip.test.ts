import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { lintFile } from "../src/files.ts";
import { anchorCode, locateBlocks, markedDefines, perChipBlocks, readPerChipFile } from "../src/per-chip.ts";
import { findings } from "./helpers.ts";
import { makeProject } from "./project.ts";

const LIST = [
	'define ROOM HASH("Room Light") # link-per-chip',
	"push 0 # link-per-chip {",
	'push HASH("StructureWallLight")',
	'push HASH("StructureDiode")',
	"poke 0 sp # link-per-chip } the list's top",
	"start:",
	"j start",
].join("\n");

describe("markedDefines", () => {
	it("takes a define's marker, with or without a space or a note, but not a block's", () => {
		expect(markedDefines("define A 1 # link-per-chip\ndefine B 2 #link-per-chip a note\ndefine C 3 # link-per-chip {\ndefine D 4 # link-per-chipper")).toEqual(["A", "B"]);
	});
});

describe("perChipBlocks", () => {
	it("finds a block between its markers, by line, with its anchors' code", () => {
		expect(perChipBlocks(LIST)).toEqual({ blocks: [{ from: "push 0", to: "poke 0 sp", start: 1, end: 4 }], problems: [] });
	});

	it("reports a marker without its pair, a block inside another, and a marker on a line with no code", () => {
		const { blocks, problems } = perChipBlocks("push 0 # link-per-chip {\npush 1 # link-per-chip {\n# link-per-chip }\npoke 0 sp # link-per-chip }\nmove r0 1 # link-per-chip }\nmove r1 1 # link-per-chip {");
		expect(blocks).toEqual([{ from: "push 0", to: "poke 0 sp", start: 0, end: 3 }]);
		expect(problems.map((p) => p.line)).toEqual([1, 2, 4, 5]);
		expect(problems[0]!.message).toBe("starts a per-chip block inside the one started on line 0");
		expect(problems[2]!.message).toBe("ends a per-chip block that wasn't started (# link-per-chip {)");
		expect(problems[3]!.message).toBe("starts a per-chip block that doesn't end (# link-per-chip })");
	});

	it("adds the per-script file's blocks, by code, once if they're marked too, and reports one the script doesn't have", () => {
		const text = "push 0\npush 1\npoke 0  sp # a comment\nmove r0 1";
		expect(perChipBlocks(text, [{ from: "push 0", to: "poke 0 sp" }])).toEqual({ blocks: [{ from: "push 0", to: "poke 0 sp", start: 0, end: 2 }], problems: [] });
		expect(perChipBlocks(LIST, [{ from: "push 0", to: "poke 0 sp" }]).blocks).toHaveLength(1);
		expect(perChipBlocks(text, [{ from: "push 0", to: "j start" }]).problems).toEqual([
			{ line: 0, message: 'the per-script file\'s block from "push 0" to "j start" isn\'t in the script' },
		]);
	});

	it("reports blocks that overlap", () => {
		const { problems } = perChipBlocks("push 0 # link-per-chip {\npush 1\npoke 0 sp # link-per-chip }", [{ from: "push 1", to: "poke 0 sp" }]);
		expect(problems).toEqual([{ line: 1, message: "a per-chip block overlaps the one on lines 0-2" }]);
	});
});

describe("locateBlocks", () => {
	const anchors = [{ from: "push 0", to: "poke 0 sp" }];

	it("finds a block by its markers first, then by its anchors' code alone", () => {
		expect(locateBlocks("push 0\npush 0 # link-per-chip {\npoke 0 sp # link-per-chip }", anchors)).toEqual([{ from: "push 0", to: "poke 0 sp", start: 1, end: 2 }]);
		expect(locateBlocks("move r0 1\npush 0\npush 5\npush 6\npoke 0 sp", anchors)).toEqual([{ from: "push 0", to: "poke 0 sp", start: 1, end: 4 }]);
	});

	it("finds each block after the one before, and gives undefined for one not there", () => {
		const two = [...anchors, { from: "push 0", to: "poke 1 sp" }];
		expect(locateBlocks("push 0\npoke 0 sp\npush 0\npoke 1 sp", two).map((b) => b?.start)).toEqual([0, 2]);
		expect(locateBlocks("push 0\npush 1", anchors)).toEqual([undefined]);
	});

	it("matches code by its tokens, so spacing and comments don't count", () => {
		expect(anchorCode('  push   HASH("a  b")  # note')).toBe('push HASH("a  b")');
	});
});

describe("readPerChipFile", () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));
	const read = (json: string) => {
		dir = mkdtempSync(join(tmpdir(), "per-chip-"));
		const file = join(dir, "a.ic10.json");
		writeFileSync(file, json);
		return readPerChipFile(file, "a.ic10.json");
	};

	it("reads names and blocks, each optional", () => {
		expect(read('{ "perChip": { "byDefineName": ["A"], "byBlock": [{ "from": "push 0", "to": "poke 0 sp" }] } }')).toMatchObject({
			names: ["A"],
			blocks: [{ from: "push 0", to: "poke 0 sp" }],
		});
		expect(read("{}")).toMatchObject({ names: [], blocks: [] });
	});

	it("throws for a bad one, naming it", () => {
		expect(() => read("{")).toThrow(/^a\.ic10\.json: not valid JSON/);
		expect(() => read('{ "perChip": { "byBlock": [{ "from": "push 0" }] } }')).toThrow('a.ic10.json: "perChip.byBlock" must be a list of { "from": <a line of code>, "to": <a line of code> }');
		expect(() => read('{ "perChip": { "byBlock": [{ "from": "# just a comment", "to": "poke 0 sp" }] } }')).toThrow(/byBlock/);
	});

	it("reads the host the script runs in, which is optional", () => {
		expect(read('{ "host": "StructureServerRack" }').host).toBe("StructureServerRack");
		expect(read("{}").host).toBeUndefined();
		expect(() => read('{ "host": 5 }')).toThrow('a.ic10.json: "host" must be a prefab name');
	});
});

describe("lintFile and the per-script file", () => {
	it("takes its blocks, and reports a bad one by its path in the project", async () => {
		const project = makeProject({
			"ic10/list.ic10": "push 0\npush 1\npoke 0 sp\nj 3",
			"ic10/list.ic10.json": { perChip: { byBlock: [{ from: "push 0", to: "poke 0 sp" }] } },
			"ic10/bad.ic10": "move r0 1",
			"ic10/bad.ic10.json": "[]",
		});
		try {
			const config = loadConfig(project.root);
			const rules = async (file: string) => (await lintFile(file, config)).findings.filter((f) => f.rule.startsWith("per-chip")).map((f) => [f.rule, f.message]);
			expect(await rules("ic10/list.ic10")).toEqual([["per-chip-jump", expect.stringContaining("j to line 3 by number")]]);
			expect(await rules("ic10/bad.ic10")).toEqual([["per-chip-block", "ic10/bad.ic10.json: must be an object"]]);
		} finally {
			project.remove();
		}
	});
});

describe("per-chip-block", () => {
	it("reports what's wrong with the blocks, and a bad per-script file, as errors", async () => {
		expect(await findings("per-chip-block", "push 0 # link-per-chip {\nmove r0 1", { perChip: { error: "a.ic10.json: must be an object" } })).toEqual([
			[0, "error", "a.ic10.json: must be an object"],
			[0, "error", "starts a per-chip block that doesn't end (# link-per-chip })"],
		]);
	});

	it("leaves a script with good blocks, or none, alone", async () => {
		expect(await findings("per-chip-block", LIST)).toEqual([]);
		expect(await findings("per-chip-block", "move r0 1")).toEqual([]);
	});
});
