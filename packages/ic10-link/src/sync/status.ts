/** How each of a station's chips compares with the project's scripts. Reads only. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Chip, listChips, type Station } from "../game/chipdata.ts";
import { loadStation } from "../project/stations.ts";
import { gameText } from "./text.ts";

export type MappedState =
	/** The chip runs the script as it is. */
	| "same"
	/** The chip and the script differ. */
	| "differs"
	/** The map names a script the project doesn't have. */
	| "no script"
	/** The game hasn't written the chip's file (the station isn't loaded, or the chip is gone). */
	| "not in game"
	/** The chip has more than one file (it was relabelled), so which is current isn't known: see `duplicates`. */
	| "several files";

export interface MappedChip {
	id: string;
	/** Undefined when the chip isn't in the game, or has several files. */
	label?: string;
	script: string;
	state: MappedState;
}

export interface UnmappedChip {
	id: string;
	label: string;
	/** Lines of code, 0 for an empty chip. */
	lines: number;
}

/** A file of a chip that has several. */
export interface ChipFile extends Chip {
	/** Lines of code, 0 for an empty one. */
	lines: number;
}

/**
 * A chip with more than one file. The mod names a chip's file after its label, so relabelling the
 * chip in game starts a new file, and the old one stays. Only the file with the current label is
 * read, and only the player knows which that is.
 */
export interface Duplicate {
	id: string;
	/** Oldest first. */
	files: ChipFile[];
}

export interface StationStatus {
	station: Station;
	mapped: MappedChip[];
	/** Unmapped chips with one file. */
	unmapped: UnmappedChip[];
	/** Chips with several files, mapped or not. */
	duplicates: Duplicate[];
}

function chipText(chip: Chip): string {
	return gameText(readFileSync(chip.path, "utf8"));
}

function lineCount(text: string): number {
	return text === "" ? 0 : text.split("\n").length;
}

/** How a mapped chip, with its files in the station (none, one, or several), compares with its script (absolute). */
function mappedState(script: string, files: Chip[]): MappedState {
	if (!existsSync(script)) return "no script";
	if (files.length === 0) return "not in game";
	if (files.length > 1) return "several files";
	return chipText(files[0]!) === gameText(readFileSync(script, "utf8")) ? "same" : "differs";
}

/** The station's chips against the project at `root`, and its `stations/<station>.json`. */
export function stationStatus(root: string, station: Station): StationStatus {
	const map = loadStation(root, station.name);
	const byId = Map.groupBy(listChips(station), (chip) => chip.id);
	const chips = new Map([...byId].filter(([, files]) => files.length === 1).map(([id, [chip]]) => [id, chip!]));
	const duplicates = [...byId]
		.filter(([, files]) => files.length > 1)
		.map(([id, files]) => ({
			id,
			files: files.map((chip) => ({ ...chip, lines: lineCount(chipText(chip)) })).sort((a, b) => a.modified - b.modified),
		}));

	const mapped = Object.entries(map.chips).map(([id, { script }]): MappedChip => ({
		id,
		label: chips.get(id)?.label,
		script,
		state: mappedState(resolve(root, script), byId.get(id) ?? []),
	}));

	const unmapped = [...chips.values()]
		.filter((chip) => !(chip.id in map.chips))
		.map((chip) => ({ id: chip.id, label: chip.label, lines: lineCount(chipText(chip)) }));

	return { station, mapped, unmapped, duplicates };
}
