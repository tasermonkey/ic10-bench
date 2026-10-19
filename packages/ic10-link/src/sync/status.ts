/** How each of a station's chips compares with the project's scripts. Reads only. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Chip, listChips, type Station } from "../game/chipdata.ts";
import { loadStation } from "../project/stations.ts";
import { defineValues, maskDefines, perChipNames } from "./defines.ts";
import { gameText } from "./text.ts";

export type MappedState =
	/** The chip runs the script as it is (but for the values of its per-chip defines). */
	| "same"
	/** The chip and the script differ. */
	| "differs"
	/** The map names a script the project doesn't have. */
	| "no script"
	/** The game hasn't written the chip's file (the station isn't loaded, or the chip is gone). */
	| "not in game"
	/** The chip has more than one file (it was relabelled), so which is current isn't known: see `duplicates`. */
	| "several files";

/** One of a script's per-chip defines (`defines.ts`), as a chip has it. */
export interface PerChipValue {
	name: string;
	/** The chip's value; undefined when the chip has no such define. */
	value?: string;
	/** False for a name in the per-script file that the script doesn't define (a typo, or one since removed). */
	inScript: boolean;
}

export interface MappedChip {
	id: string;
	/** Undefined when the chip isn't in the game, or has several files. */
	label?: string;
	script: string;
	state: MappedState;
	/** The script's per-chip defines, as this chip has them, when it's `same` or `differs` and the script has any. */
	perChip?: PerChipValue[];
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

/**
 * How a mapped chip, with its files in the station (none, one, or several), compares with its
 * script (absolute): but for the values of the script's per-chip defines, which it lists.
 */
function compare(script: string, files: Chip[]): Pick<MappedChip, "state" | "perChip"> {
	if (!existsSync(script)) return { state: "no script" };
	if (files.length === 0) return { state: "not in game" };
	if (files.length > 1) return { state: "several files" };
	const scriptText = gameText(readFileSync(script, "utf8"));
	const text = chipText(files[0]!);
	const names = perChipNames(script, scriptText);
	const state = maskDefines(text, names) === maskDefines(scriptText, names) ? "same" : "differs";
	if (names.length === 0) return { state };
	const values = defineValues(text, names);
	const inScript = defineValues(scriptText, names);
	return { state, perChip: names.map((name) => ({ name, value: values.get(name), inScript: inScript.has(name) })) };
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
		...compare(resolve(root, script), byId.get(id) ?? []),
	}));

	const unmapped = [...chips.values()]
		.filter((chip) => !(chip.id in map.chips))
		.map((chip) => ({ id: chip.id, label: chip.label, lines: lineCount(chipText(chip)) }));

	return { station, mapped, unmapped, duplicates };
}
