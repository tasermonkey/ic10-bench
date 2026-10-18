import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findStation } from "../../src/game/chipdata.ts";
import { stationStatus } from "../../src/sync/status.ts";
import { gameText } from "../../src/sync/text.ts";
import { type Folder, makeFolder } from "../project.ts";

const folders: Folder[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) folder.remove();
});

function setup(chips: Record<string, string>, project: Record<string, string | object>) {
	const chipdata = makeFolder(Object.fromEntries(Object.entries(chips).map(([name, text]) => [join("Base", name), text])));
	const root = makeFolder(project);
	folders.push(chipdata, root);
	return stationStatus(root.root, findStation(chipdata.root));
}

describe("gameText", () => {
	it("reads a script as the game keeps it", () => {
		expect(gameText("start:  \r\n\tyield\r\nj start\r\n\r\n")).toBe("start:\n yield\nj start");
		expect(gameText("s db Setting 1 # 1°C")).toBe("s db Setting 1 # 1C");
	});
});

describe("stationStatus", () => {
	it("lists every chip as unmapped when the station has no map", () => {
		const { mapped, unmapped } = setup({ "Script1 [450].ic10": "start:\nyield\nj start", "Integrated Circuit (IC10) [448].ic10": "" }, {});
		expect(mapped).toEqual([]);
		expect(unmapped).toEqual([
			{ id: "448", label: "Integrated Circuit (IC10)", lines: 0 },
			{ id: "450", label: "Script1", lines: 3 },
		]);
	});

	it("compares each mapped chip with its script, as the game reads them", () => {
		const { mapped, unmapped } = setup(
			{ "Same [1].ic10": "start:\nyield\nj start\n", "Differs [2].ic10": "yield", "Other [3].ic10": "yield" },
			{
				"ic10/same.ic10": "start:  \r\nyield\r\nj start",
				"ic10/differs.ic10": "sleep 1",
				"stations/Base.json": {
					chips: { "1": "ic10/same.ic10", "2": "ic10/differs.ic10", "4": "ic10/same.ic10", "3": "ic10/gone.ic10" },
				},
			},
		);
		expect(mapped).toEqual([
			{ id: "1", label: "Same", script: "ic10/same.ic10", state: "same" },
			{ id: "2", label: "Differs", script: "ic10/differs.ic10", state: "differs" },
			{ id: "3", label: "Other", script: "ic10/gone.ic10", state: "no script" },
			{ id: "4", label: undefined, script: "ic10/same.ic10", state: "not in game" },
		]);
		expect(unmapped).toEqual([]);
	});

	// The order of the files, oldest first, is in cli.test.ts, which sets their times.
	it("reports a chip with several files (relabelled in game) apart", () => {
		const { mapped, unmapped, duplicates } = setup(
			{ "New [1].ic10": "yield\nyield", "Old [1].ic10": "yield", "Other [2].ic10": "", "Was [2].ic10": "" },
			{ "ic10/a.ic10": "yield", "stations/Base.json": { chips: { "1": "ic10/a.ic10" } } },
		);
		expect(mapped).toEqual([{ id: "1", label: undefined, script: "ic10/a.ic10", state: "several files" }]);
		expect(unmapped).toEqual([]);
		expect(duplicates.map((duplicate) => duplicate.id)).toEqual(["1", "2"]);
		const files = duplicates[0]!.files;
		expect(Object.fromEntries(files.map((file) => [file.label, file.lines]))).toEqual({ New: 2, Old: 1 });
		expect(files[0]!.modified).toBeLessThanOrEqual(files[1]!.modified);
	});

	it("reads a chip's entry as an object, or as just its script's path", () => {
		const { mapped } = setup(
			{ "A [1].ic10": "yield", "B [2].ic10": "yield" },
			{ "ic10/a.ic10": "yield", "stations/Base.json": { chips: { "1": { script: "ic10/a.ic10" }, "2": "ic10/a.ic10" } } },
		);
		expect(mapped.map(({ id, script, state }) => ({ id, script, state }))).toEqual([
			{ id: "1", script: "ic10/a.ic10", state: "same" },
			{ id: "2", script: "ic10/a.ic10", state: "same" },
		]);
	});

	it("rejects a map that isn't chip ids to scripts", () => {
		const chips = { "Script1 [450].ic10": "" };
		expect(() => setup(chips, { "stations/Base.json": { chips: { Script1: "ic10/a.ic10" } } })).toThrow(`"Script1" isn't a chip id`);
		expect(() => setup(chips, { "stations/Base.json": { chips: { "450": { ignore: [1] } } } })).toThrow(`chip "450" has no "script"`);
		expect(() => setup(chips, { "stations/Base.json": { chips: { "450": 7 } } })).toThrow(`chip "450" has no "script"`);
	});
});
