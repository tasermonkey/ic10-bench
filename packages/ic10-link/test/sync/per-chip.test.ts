import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markedDefines } from "@tasermonkey/ic10-lint";
import { afterEach, describe, expect, it } from "vitest";
import {
	addPerChipBlock,
	blockLines,
	checkPerChipFiles,
	defineValues,
	maskDefines,
	maskPerChip,
	perChipOf,
	perChipValues,
	withDefines,
	withPerChip,
} from "../../src/sync/per-chip.ts";
import { type Folder, makeFolder } from "../project.ts";

const perChipNames = (script: string, text: string) => perChipOf(script, text).names;

const folders: Folder[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) folder.remove();
});

const SCRIPT = [
	'define ROOM HASH("Room Light") # link-per-chip',
	"define MAX 303 #link-per-chip this room's limit",
	"define DELAY $1F # not link-per-chip, a note",
	"alias Sensor d0 # link-per-chip",
	"start:",
	"yield",
].join("\n");

describe("markedDefines", () => {
	it("finds the defines whose comment starts with link-per-chip, with or without a space, a note after it or not", () => {
		expect(markedDefines(SCRIPT)).toEqual(["ROOM", "MAX"]);
	});

	it("doesn't take a comment that only mentions it, or a longer word", () => {
		expect(markedDefines("define A 1 # see link-per-chip\ndefine B 2 # link-per-chips")).toEqual([]);
	});
});

describe("defineValues, maskDefines and withDefines", () => {
	it("reads each name's value, a HASH with spaces as one", () => {
		expect(defineValues(SCRIPT, ["ROOM", "DELAY", "GONE"])).toEqual(
			new Map([
				["ROOM", 'HASH("Room Light")'],
				["DELAY", "$1F"],
			]),
		);
	});

	it("masks the named values only, keeping each line's comment", () => {
		expect(maskDefines(SCRIPT, ["ROOM", "DELAY"]).split("\n").slice(0, 3)).toEqual([
			"define ROOM * # link-per-chip",
			"define MAX 303 #link-per-chip this room's limit",
			"define DELAY * # not link-per-chip, a note",
		]);
	});

	it("gives the named defines new values, and leaves out a name the text doesn't define", () => {
		const values = new Map([
			["ROOM", 'HASH("Hall Light")'],
			["GONE", "1"],
		]);
		expect(withDefines(SCRIPT, values).split("\n")[0]).toBe('define ROOM HASH("Hall Light") # link-per-chip');
		expect(withDefines(SCRIPT, values).split("\n").slice(1)).toEqual(SCRIPT.split("\n").slice(1));
	});

	it("returns the text as it is with no names", () => {
		expect(maskDefines(SCRIPT, [])).toBe(SCRIPT);
		expect(withDefines(SCRIPT, new Map())).toBe(SCRIPT);
	});
});

describe("perChipNames", () => {
	it("takes the marked defines and the per-script file's, once each", () => {
		const project = makeFolder({ "ic10/room.ic10.json": { perChip: { byDefineName: ["DELAY", "ROOM"] } } });
		folders.push(project);
		expect(perChipNames(join(project.root, "ic10", "room.ic10"), SCRIPT)).toEqual(["ROOM", "MAX", "DELAY"]);
		expect(perChipNames(join(project.root, "ic10", "other.ic10"), SCRIPT)).toEqual(["ROOM", "MAX"]);
	});

	it("takes a per-script file with no perChip, and throws for a bad one, naming it", () => {
		const project = makeFolder({
			"empty.ic10.json": {},
			"list.ic10.json": { perChip: { byDefineName: "ROOM" } },
			"name.ic10.json": { perChip: { byDefineName: ["two words"] } },
			"json.ic10.json": "{ nope",
		});
		folders.push(project);
		const names = (file: string) => () => perChipNames(join(project.root, file), "yield");
		expect(names("empty.ic10")()).toEqual([]);
		expect(names("list.ic10")).toThrow(/list\.ic10\.json: "perChip\.byDefineName" must be a list of define names/);
		expect(names("name.ic10")).toThrow(/name\.ic10\.json: "perChip\.byDefineName" must be a list of define names/);
		expect(names("json.ic10")).toThrow(/json\.ic10\.json: not valid JSON/);
	});
});

const LIST = [
	'define ROOM HASH("Room Light") # link-per-chip',
	"push 0 # link-per-chip {",
	'push HASH("StructureWallLight")',
	"poke 0 sp # link-per-chip }",
	"start:",
	"j start",
].join("\n");
/** A chip running LIST with its own room and list, three long, and without the markers. */
const CHIP = ['define ROOM HASH("Hall Light") # link-per-chip', "push 0", "push 1", "push 2", "push 3", "poke 0 sp", "start:", "j start"].join("\n");

describe("per-chip blocks", () => {
	const perChip = { names: ["ROOM"], blocks: [{ from: "push 0", to: "poke 0 sp" }] };

	it("takes the script's marked blocks and its per-script file's", () => {
		const project = makeFolder({ "list.ic10.json": { perChip: { byBlock: [{ from: "start:", to: "j start" }] } } });
		folders.push(project);
		expect(perChipOf(join(project.root, "list.ic10"), LIST).blocks).toEqual([
			{ from: "push 0", to: "poke 0 sp" },
			{ from: "start:", to: "j start" },
		]);
	});

	it("reads each block's lines, found by its markers or its anchors' code", () => {
		expect(blockLines(LIST, perChip.blocks)).toEqual([['push HASH("StructureWallLight")']]);
		expect(blockLines(CHIP, perChip.blocks)).toEqual([["push 1", "push 2", "push 3"]]);
		expect(blockLines("move r0 1", perChip.blocks)).toEqual([undefined]);
	});

	it("masks a block's lines as one, however many, and its anchors' markers, so the two compare the same", () => {
		expect(maskPerChip(CHIP, perChip)).toBe(["define ROOM * # link-per-chip", "push 0", "*", "poke 0 sp", "start:", "j start"].join("\n"));
		expect(maskPerChip(LIST, perChip)).toBe(maskPerChip(CHIP, perChip));
	});

	it("sends the script with the chip's lines and value, keeping the script's anchors and their markers", () => {
		expect(withPerChip(LIST, perChip, perChipValues(CHIP, perChip)).split("\n")).toEqual([
			'define ROOM HASH("Hall Light") # link-per-chip',
			"push 0 # link-per-chip {",
			"push 1",
			"push 2",
			"push 3",
			"poke 0 sp # link-per-chip }",
			"start:",
			"j start",
		]);
	});

	it("leaves a block the other text doesn't have as it is", () => {
		expect(withPerChip(LIST, perChip, perChipValues("", perChip))).toBe(LIST);
	});

	it("adds a block to the per-script file once, by its code, keeping the rest", () => {
		const project = makeFolder({ "list.ic10.json": { perChip: { byDefineName: ["ROOM"] }, other: 1 } });
		folders.push(project);
		const script = join(project.root, "list.ic10");
		expect(addPerChipBlock(script, { from: "push  0", to: "poke 0 sp # top" })).toBe(true);
		expect(addPerChipBlock(script, { from: "push 0", to: "poke 0 sp" })).toBe(false);
		expect(JSON.parse(readFileSync(`${script}.json`, "utf8"))).toEqual({
			perChip: { byDefineName: ["ROOM"], byBlock: [{ from: "push 0", to: "poke 0 sp" }] },
			other: 1,
		});
	});
});

describe("checkPerChipFiles", () => {
	it("lists the per-script files whose script is gone, but not those in node_modules or dot-folders", () => {
		const project = makeFolder({
			"ic10/room.ic10": "yield",
			"ic10/room.ic10.json": {},
			"ic10/Moved/gone.ic10.json": {},
			"node_modules/pkg/x.ic10.json": {},
			".ic10-link/y.ic10.json": {},
		});
		folders.push(project);
		expect(checkPerChipFiles(project.root)).toEqual(["ic10/Moved/gone.ic10.json"]);
	});
});
