/**
 * The project's side: `stations/<station>.json`, which chip runs which of the project's scripts.
 *
 *     { "chips": { "450": { "script": "ic10/Misc/Sync Demo.ic10" } } }
 *     { "chips": { "450": "ic10/Misc/Sync Demo.ic10" } }
 *
 * Keyed by the chip's id, so relabelling the chip in game doesn't lose it. Each chip's entry is an
 * object, so settings for that chip can sit beside its script; a chip with only a script can be
 * written as just its path, and is saved that way. Paths are relative to the project, with forward
 * slashes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const STATIONS_DIR = "stations";

/** One chip's entry in the map. */
export interface ChipEntry {
	/** The script the chip runs, relative to the project. */
	script: string;
}

export interface StationMap {
	/** Chip id → its entry. */
	chips: Record<string, ChipEntry>;
}

/** A chip's entry as the file has it: the object, or just the script's path. */
type ChipEntryJson = ChipEntry | string;

/** The map's file. The station's name is the chipdata folder's, which the mod made safe for a file name. */
export function stationFile(root: string, station: string): string {
	return join(root, STATIONS_DIR, `${station}.json`);
}

/** The station's map, or an empty one if it has none yet. */
export function loadStation(root: string, station: string): StationMap {
	const file = stationFile(root, station);
	if (!existsSync(file)) return { chips: {} };
	const json = JSON.parse(readFileSync(file, "utf8"));
	if (typeof json?.chips !== "object" || json.chips === null) throw new Error(`${file}: no "chips"`);
	const chips: Record<string, ChipEntry> = {};
	for (const [id, given] of Object.entries<unknown>(json.chips)) {
		if (!/^\d+$/.test(id)) throw new Error(`${file}: "${id}" isn't a chip id (the number in brackets in its file's name)`);
		const entry = typeof given === "string" ? { script: given } : (given as Partial<ChipEntry> | null);
		if (typeof entry?.script !== "string") throw new Error(`${file}: chip "${id}" has no "script"`);
		chips[id] = entry as ChipEntry;
	}
	return { ...json, chips };
}

/** Writes the station's map, tab-indented, chips in id order; a chip with only a script as just its path. */
export function saveStation(root: string, station: string, map: StationMap): void {
	const file = stationFile(root, station);
	const chips = Object.fromEntries(
		Object.entries(map.chips)
			.sort(([a], [b]) => Number(a) - Number(b))
			.map(([id, entry]): [string, ChipEntryJson] => [id, Object.keys(entry).length === 1 ? entry.script : entry]),
	);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify({ ...map, chips }, null, "\t")}\n`);
}

/**
 * A script's path as the map keeps it: relative to the project, with forward slashes. `path` is
 * relative to `cwd`. Throws for a path outside the project, or one that isn't a `.ic10` file.
 */
export function scriptPath(root: string, cwd: string, path: string): string {
	const inProject = relative(root, resolve(cwd, path));
	if (inProject.startsWith("..") || isAbsolute(inProject)) throw new Error(`${path}: not in the project (${root})`);
	if (!inProject.toLowerCase().endsWith(".ic10")) throw new Error(`${path}: not a .ic10 file`);
	return inProject.replaceAll("\\", "/");
}
