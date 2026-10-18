import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findChipdata, findStation, listChips, parseChipFile } from "../../src/game/chipdata.ts";
import { type Folder, makeFolder, touch } from "../project.ts";

let folder: Folder | undefined;
afterEach(() => folder?.remove());

describe("parseChipFile", () => {
	it("splits a chip's file name into its label and id", () => {
		expect(parseChipFile("Script1 [450].ic10")).toEqual({ label: "Script1", id: "450" });
		expect(parseChipFile("Computer (Modern) IC Editor Motherboard [646].ic10")).toEqual({
			label: "Computer (Modern) IC Editor Motherboard",
			id: "646",
		});
	});

	it("takes the id from the last brackets, so a label can have brackets of its own", () => {
		expect(parseChipFile("Mixer [old] [43093].ic10")).toEqual({ label: "Mixer [old]", id: "43093" });
	});

	it("skips anything that isn't a chip's file", () => {
		expect(parseChipFile("notes.ic10")).toBeUndefined();
		expect(parseChipFile("Script1 [450].txt")).toBeUndefined();
		expect(parseChipFile("Script1 [abc].ic10")).toBeUndefined();
	});
});

describe("findChipdata", () => {
	const documents = () => "D:\\OneDrive\\Documents";

	it("takes --chipdata first, relative to the working folder", () => {
		const found = findChipdata({ chipdata: "chips", cwd: "/project", env: { IC10_CHIPDATA: "/elsewhere" }, documents });
		expect(found).toBe(resolve("/project", "chips"));
	});

	it("then IC10_CHIPDATA", () => {
		expect(findChipdata({ cwd: "/project", env: { IC10_CHIPDATA: "/elsewhere" }, documents })).toBe(resolve("/elsewhere"));
	});

	it("then the chipdata folder under Windows' Documents folder, wherever that's been moved", () => {
		expect(findChipdata({ env: {}, documents })).toBe(join("D:\\OneDrive\\Documents", "My Games", "Stationeers", "chipdata"));
	});
});

describe("findStation and listChips", () => {
	function chipdata() {
		folder = makeFolder({
			"Old Base/Lights [12].ic10": "yield",
			"New Base/Script1 [450].ic10": "yield",
			"New Base/Integrated Circuit (IC10) [448].ic10": "",
			"New Base/notes.txt": "",
		});
		touch(join(folder.root, "Old Base", "Lights [12].ic10"), 3600);
		touch(join(folder.root, "Old Base"), 3600);
		touch(join(folder.root, "New Base", "Script1 [450].ic10"), 60);
		return folder.root;
	}

	it("picks the station played most recently", () => {
		expect(findStation(chipdata()).name).toBe("New Base");
	});

	it("picks a station by name, whatever its case", () => {
		const root = chipdata();
		expect(findStation(root, "old base")).toEqual({ name: "Old Base", dir: join(root, "Old Base") });
		expect(() => findStation(root, "Gone")).toThrow('no station "Gone". There are: New Base, Old Base');
	});

	it("says so when there's no chipdata folder, or no station in it", () => {
		expect(() => findStation(join("no", "such", "folder"))).toThrow("no chipdata folder");
		folder = makeFolder({ "readme.txt": "" });
		expect(() => findStation(folder!.root)).toThrow("no stations yet");
	});

	it("lists a station's chips by id, skipping other files", () => {
		const station = findStation(chipdata());
		expect(listChips(station).map(({ id, label }) => ({ id, label }))).toEqual([
			{ id: "448", label: "Integrated Circuit (IC10)" },
			{ id: "450", label: "Script1" },
		]);
	});
});
