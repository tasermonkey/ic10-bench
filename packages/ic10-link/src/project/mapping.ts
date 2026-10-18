/** Changing a station's map: `map`, `adopt` and `unmap`. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Chip, listChips, type Station } from "../game/chipdata.ts";
import { gameText } from "../sync/text.ts";
import { loadStation, saveStation } from "./stations.ts";

export interface MapResult {
	/** The chip's file, when the game has exactly one for it. */
	chip?: Chip;
	/** How many files the game has for the chip: 0 before the station is loaded with it, 2 or more once relabelled. */
	files: number;
	/** The script it was mapped to before, if another. */
	previous?: string;
}

/** `450` or `[450]` → `450`. */
export function chipId(text: string): string {
	const id = /^\[?(\d+)\]?$/.exec(text.trim())?.[1];
	if (id === undefined) throw new Error(`${text}: not a chip id (the number in brackets in its file's name)`);
	return id;
}

function chipFiles(station: Station, id: string): Chip[] {
	return listChips(station).filter((chip) => chip.id === id);
}

/**
 * Maps chip `id` to `script` (relative to the project, from `scriptPath`), which must exist. The
 * chip's other settings in the map, if it has any, stay.
 */
export function mapChip(root: string, station: Station, id: string, script: string): MapResult {
	if (!existsSync(resolve(root, script))) throw new Error(`${script}: no such script. To copy the chip's code from the game into it, use adopt.`);
	const map = loadStation(root, station.name);
	const before = map.chips[id]?.script;
	map.chips[id] = { ...map.chips[id], script };
	saveStation(root, station.name, map);
	const files = chipFiles(station, id);
	return { chip: files.length === 1 ? files[0] : undefined, files: files.length, previous: before !== script ? before : undefined };
}

/** Copies chip `id`'s code from the game into a new `script` (relative to the project), and maps it. */
export function adoptChip(root: string, station: Station, id: string, script: string): MapResult & { lines: number } {
	const files = chipFiles(station, id);
	if (files.length === 0) throw new Error(`No chip [${id}] in ${station.name}. Is the station loaded, with the chip in it?`);
	if (files.length > 1) throw new Error(`Chip [${id}] has ${files.length} files. Run ic10-link status to choose the current one.`);
	const file = resolve(root, script);
	if (existsSync(file)) throw new Error(`${script} already exists. To have the chip run it as it is, use map.`);
	const text = gameText(readFileSync(files[0]!.path, "utf8"));
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, text === "" ? "" : `${text}\n`);
	return { ...mapChip(root, station, id, script), lines: text === "" ? 0 : text.split("\n").length };
}

/** Takes chip `id` out of the map; returns the script it was mapped to. */
export function unmapChip(root: string, station: Station, id: string): string {
	const map = loadStation(root, station.name);
	const entry = map.chips[id];
	if (entry === undefined) throw new Error(`Chip [${id}] isn't mapped in ${station.name}.`);
	delete map.chips[id];
	saveStation(root, station.name, map);
	return entry.script;
}
