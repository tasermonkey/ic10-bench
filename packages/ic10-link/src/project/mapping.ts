/** Changing a station's map: `map`, `adopt`, `auto-map` and `unmap`. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { findScripts, loadConfig, projectRelative } from "@tasermonkey/ic10-lint";
import { type Chip, listChips, type Station } from "../game/chipdata.ts";
import { stationStatus } from "../sync/status.ts";
import { gameText } from "../sync/text.ts";
import { loadStation, saveStation, scriptPath } from "./stations.ts";

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

/** A chip `autoMap` mapped. */
export interface AutoMapped {
	id: string;
	label: string;
	/** Relative to the project, with forward slashes. */
	script: string;
}

/** An empty chip `autoMap` left alone, since its label names more than one script. */
export interface AutoMapAmbiguous {
	id: string;
	label: string;
	/** The scripts it names, relative to the project. */
	scripts: string[];
}

export interface AutoMapResult {
	/** The project's folder of scripts (ic10-lint's `dir`), relative to the project. */
	dir: string;
	mapped: AutoMapped[];
	ambiguous: AutoMapAmbiguous[];
}

/** A label or a script's name, as `autoMap` compares them: trimmed, ignoring case, as Windows' file names do. */
function nameKey(name: string): string {
	return name.trim().toLowerCase();
}

/**
 * Maps each of the station's empty, unmapped chips whose label is the name of exactly one script
 * in the project's folder of scripts (ic10-lint's `dir`, `ic10` by default), without `.ic10`: a
 * chip labelled `Room Lights` runs `ic10/EControl/Room Lights.ic10`. A chip with code is left
 * alone, since `adopt` or `map` would decide what happens to its code; so is a relabelled chip's,
 * until `status` has picked its file.
 */
export function autoMap(root: string, station: Station): AutoMapResult {
	const config = loadConfig(root);
	const scripts = existsSync(config.dir) ? findScripts(config.dir) : [];
	const byName = Map.groupBy(
		scripts.map((file) => scriptPath(root, root, file)),
		(script) => nameKey(basename(script, ".ic10")),
	);
	const result: AutoMapResult = { dir: projectRelative(root, config.dir) || ".", mapped: [], ambiguous: [] };
	for (const chip of stationStatus(root, station).unmapped.filter((chip) => chip.lines === 0)) {
		const named = byName.get(nameKey(chip.label)) ?? [];
		if (named.length === 1) result.mapped.push({ id: chip.id, label: chip.label, script: named[0]! });
		if (named.length > 1) result.ambiguous.push({ id: chip.id, label: chip.label, scripts: named });
	}
	if (result.mapped.length > 0) {
		const map = loadStation(root, station.name);
		for (const { id, script } of result.mapped) map.chips[id] = { script };
		saveStation(root, station.name, map);
	}
	return result;
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
