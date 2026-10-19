import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPerChipFiles, defineValues, markedDefines, maskDefines, perChipNames, withDefines } from "../../src/sync/defines.ts";
import { type Folder, makeFolder } from "../project.ts";

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
