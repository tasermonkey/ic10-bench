/**
 * The game's side: the folder the IC10Sync mod writes to, one subfolder per station, and in it one
 * `<label> [<id>].ic10` file per chip.
 *
 * The layout is the IC10Sync mod's, as of version 0.2.6227.27061.1 (`IC10Sync.cs`,
 * `WriteAllChipData`): `{chip.DisplayName} [{chip.ReferenceId}].ic10` for a chip in a housing, and
 * `{computer.DisplayName} {motherboard.DisplayName} [{motherboard.ReferenceId}].ic10` for a
 * computer's or laptop's motherboard. The station subfolder comes from tasermonkey's fork
 * (commit ea7bbf2, same version number). If the mod changes how it names files, this has to follow.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { documentsFolder } from "./os.ts";

/** The chipdata folder under the Documents folder, as the mod has it by default. */
export const CHIPDATA_IN_DOCUMENTS = join("My Games", "Stationeers", "chipdata");

/** Overrides the chipdata folder, like `--chipdata`. */
export const CHIPDATA_ENV = "IC10_CHIPDATA";

export interface Chip {
	/** The chip's reference id, the number in brackets. Kept as text, as the station map's keys are. */
	id: string;
	/** What the game calls it: the chip's label, or its prefab's name. */
	label: string;
	/** The chip's file, absolute. */
	path: string;
	/** When the file last changed, in ms since 1970. */
	modified: number;
}

/** A save game (the game calls it a station), as its subfolder of the chipdata folder. */
export interface Station {
	/** The station's subfolder's name: the save's station name, made safe for a file name by the mod. */
	name: string;
	/** That subfolder, absolute. */
	dir: string;
}

export interface FindOptions {
	/** `--chipdata`, relative to `cwd`. */
	chipdata?: string;
	/** What relative paths are from. Default: the working folder. */
	cwd?: string;
	/** Where IC10_CHIPDATA and Windows' variables are read from. Default: `process.env`. */
	env?: NodeJS.ProcessEnv;
	/** The Documents folder as Windows has it, or undefined. For tests; default reads the registry (`os.ts`). */
	documents?: () => string | undefined;
}

const CHIP_FILE = /^(.*) \[(\d+)\]\.ic10$/i;

/** `Script1 [450].ic10` → `{ label: "Script1", id: "450" }`; undefined for any other name. */
export function parseChipFile(name: string): { label: string; id: string } | undefined {
	const match = CHIP_FILE.exec(name);
	return match ? { label: match[1]!, id: match[2]! } : undefined;
}

/** The chipdata folder: `--chipdata`, else IC10_CHIPDATA, else the one under the Documents folder. */
export function findChipdata(options: FindOptions = {}): string {
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	if (options.chipdata) return resolve(cwd, options.chipdata);
	if (env[CHIPDATA_ENV]) return resolve(cwd, env[CHIPDATA_ENV]);
	return join(documentsFolder(env, options.documents), CHIPDATA_IN_DOCUMENTS);
}

/** When a station's chips last changed: its newest file, or the folder itself. */
function lastChanged(dir: string): number {
	let newest = statSync(dir).mtimeMs;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isFile()) newest = Math.max(newest, statSync(join(dir, entry.name)).mtimeMs);
	}
	return newest;
}

/** The stations in the chipdata folder (its subfolders), the most recently played first. */
export function listStations(chipdata: string): Station[] {
	if (!existsSync(chipdata)) throw new Error(`${chipdata}: no chipdata folder. Is the IC10Sync mod installed? Or give --chipdata.`);
	return readdirSync(chipdata, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => ({ name: entry.name, dir: join(chipdata, entry.name), changed: lastChanged(join(chipdata, entry.name)) }))
		.sort((a, b) => b.changed - a.changed)
		.map(({ name, dir }) => ({ name, dir }));
}

/** The station by name, else the most recently played one. */
export function findStation(chipdata: string, name?: string): Station {
	const stations = listStations(chipdata);
	if (name === undefined) {
		if (stations.length === 0) throw new Error(`${chipdata}: no stations yet. Load a save with the IC10Sync mod on.`);
		return stations[0]!;
	}
	const station = stations.find((s) => s.name.toLowerCase() === name.toLowerCase());
	if (!station) throw new Error(`${chipdata}: no station "${name}". There are: ${stations.map((s) => s.name).join(", ") || "none"}`);
	return station;
}

/** A station's chip files, by id. A chip relabelled in game has a file for each label (see `Duplicate`). */
export function listChips(station: Station): Chip[] {
	return readdirSync(station.dir, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.flatMap((entry) => {
			const parsed = parseChipFile(entry.name);
			const path = join(station.dir, entry.name);
			return parsed ? [{ ...parsed, path, modified: statSync(path).mtimeMs }] : [];
		})
		.sort((a, b) => Number(a.id) - Number(b.id));
}
