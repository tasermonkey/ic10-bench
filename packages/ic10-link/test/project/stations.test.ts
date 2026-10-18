import { afterEach, describe, expect, it } from "vitest";
import { checkStations } from "../../src/project/stations.ts";
import { type Folder, makeFolder } from "../project.ts";

const folders: Folder[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) folder.remove();
});

function project(files: Record<string, string | object>): string {
	const folder = makeFolder(files);
	folders.push(folder);
	return folder.root;
}

describe("checkStations", () => {
	it("lists each station's chips whose script the project doesn't have", () => {
		const root = project({
			"ic10/lights.ic10": "yield",
			"stations/Base.json": { chips: { "450": "ic10/lights.ic10", "451": { script: "ic10/gone.ic10" } } },
			"stations/Moon Base.json": { chips: { "7": "ic10/Moved/lights.ic10" } },
		});
		expect(checkStations(root)).toEqual([
			{ station: "Base", id: "451", script: "ic10/gone.ic10" },
			{ station: "Moon Base", id: "7", script: "ic10/Moved/lights.ic10" },
		]);
	});

	it("finds nothing missing in a project with no stations/", () => {
		expect(checkStations(project({ "ic10/lights.ic10": "yield" }))).toEqual([]);
	});

	it("throws for a map that doesn't load", () => {
		const root = project({ "stations/Base.json": { chips: { Script1: "ic10/lights.ic10" } } });
		expect(() => checkStations(root)).toThrow('"Script1" isn\'t a chip id');
	});
});
