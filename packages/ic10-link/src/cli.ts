import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { runProgram } from "@tasermonkey/ic10-lint";
import { CHIPDATA_ENV, type FindOptions, findChipdata, findStation, type Station } from "./game/chipdata.ts";
import { adoptChip, chipId, type MapResult, mapChip, unmapChip } from "./project/mapping.ts";
import { scriptPath, stationFile } from "./project/stations.ts";
import { addPerChipNames, defineValues, perChipNames } from "./sync/defines.ts";
import type { GateOptions } from "./sync/gate.ts";
import { type Duplicate, type PerChipValue, stationStatus } from "./sync/status.ts";
import { repl, type Terminal } from "./repl/repl.ts";
import { type SyncOptions, stationLabel, syncOnce } from "./sync/sync.ts";
import { gameText } from "./sync/text.ts";
import { watch } from "./watch/watch.ts";

/** After the list of commands in `ic10-link --help`; each command's `--help` says more. */
const ABOUT = `A station's map, stations/<station>.json, says which chip runs which of this project's scripts.
ic10-link <command> --help says more about each command.`;

/** In `map`, `adopt` and `unmap`'s `--help`. */
const ABOUT_MAP = `A station's map, stations/<station>.json, says which chip runs which of this project's scripts.
A chip's id is the number in brackets in its file's name: 450 for "Script1 [450].ic10".`;

/** In `once` and `watch`'s `--help`. */
const ABOUT_SYNC = `A script's tests are the test files that name it; they run with the project's Vitest.
A chip edited in game is copied to its script, then checked: the result is reported, not enforced.
If a chip and its script were both changed, the script is sent, and the chip's code is kept in
.ic10-link/preserved/<station>/conflicts/. once exits 1 if anything failed its checks.`;

/** In `per-chip`'s `--help`. */
const ABOUT_PER_CHIP = `A per-chip define's value belongs to each chip that runs the script: a chip keeps its own when
sent the script, and the script keeps its own when sent a chip's edit. A define can also be made
per-chip in the script itself, with a comment starting link-per-chip on its line:
  define ROOM_LIGHT HASH("Room Light") # link-per-chip`;

/** In `status`'s `--help`. */
const ABOUT_STATUS = `A chip relabelled in game has a file for each label, and the IC10Sync mod only uses the one with
its current label. In a terminal, status asks which one that is, and deletes the others.
Otherwise it lists them, and the exit code is 1.`;

export interface CliIo extends Pick<GateOptions, "findTests" | "runTests"> {
	/** The project: where stations/ is. */
	cwd: string;
	out: (text: string) => void;
	/** Asks the player to pick one of `choices`, and returns its index. Only in an interactive terminal; throws if they cancel. */
	choose?: (question: string, choices: string[]) => Promise<number>;
	env?: NodeJS.ProcessEnv;
	/** The Documents folder; for tests. Default reads Windows' registry. */
	documents?: FindOptions["documents"];
	/** Stops `watch`. */
	signal?: AbortSignal;
	/** What stops `watch`, as its first line says. Default `Ctrl+C`; the REPL's `stop`. */
	stopWith?: string;
	/** Colour the output (ic10-lint's `wantsColor()`). Default off. */
	color?: boolean;
	/** Where `repl` reads and writes; without it, `repl` can't run. */
	terminal?: Terminal;
}

/** `2026-10-16 21:40`, in local time. */
function formatTime(ms: number): string {
	const date = new Date(ms);
	const two = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** `1 line`, `18 lines`. */
function lines(count: number): string {
	return `${count} line${count === 1 ? "" : "s"}`;
}

/** A line per file: its name, when it changed, and how many lines it has. */
function describeFiles(duplicate: Duplicate): string[] {
	const width = Math.max(...duplicate.files.map((file) => basename(file.path).length));
	return duplicate.files.map((file) => {
		const size = file.lines === 0 ? "empty" : lines(file.lines);
		return `${basename(file.path).padEnd(width)}  modified ${formatTime(file.modified)}, ${size}`;
	});
}

/** Asks which of a chip's files is current, and deletes the others. False if the player skips it. */
async function resolveDuplicate(duplicate: Duplicate, choose: NonNullable<CliIo["choose"]>, io: CliIo): Promise<boolean> {
	const files = describeFiles(duplicate);
	io.out(`\nChip ${duplicate.id} has ${files.length} files. The IC10Sync mod only uses the one with the chip's label now.`);
	const choice = await choose("Which one is current? The others are deleted.", [...files, "Skip: keep them all"]);
	if (choice >= duplicate.files.length) return false;
	for (const [i, file] of duplicate.files.entries()) {
		if (i === choice) continue;
		rmSync(file.path);
		io.out(`  deleted ${basename(file.path)}`);
	}
	return true;
}

/** ` (per chip: ROOM_LIGHT=HASH("Hall Light"), MAX_TEMP not in the script)`, or nothing. */
function describePerChip(values: PerChipValue[] | undefined): string {
	if (!values) return "";
	const parts = values.map(({ name, value, inScript }) => (inScript ? `${name}=${value ?? "?"}` : `${name} not in the script`));
	return ` (per chip: ${parts.join(", ")})`;
}

/** What `map` and `adopt` say about the chip once it's mapped. */
function reportMapped(id: string, script: string, result: MapResult, io: CliIo): void {
	io.out(`Mapped [${id}] ${result.chip?.label ?? "?"} -> ${script}${result.previous ? ` (was ${result.previous})` : ""}`);
	if (result.files === 0) io.out(`The game has no file for chip ${id} yet. It writes one once the station is loaded with the chip in it.`);
	if (result.files > 1) io.out(`Chip ${id} has ${result.files} files. Run ic10-link status to choose the current one.`);
}

async function status(station: Station, io: CliIo): Promise<number> {
	let result = stationStatus(io.cwd, station);
	if (io.choose && result.duplicates.length > 0) {
		for (const duplicate of result.duplicates) await resolveDuplicate(duplicate, io.choose, io);
		io.out("");
		result = stationStatus(io.cwd, station);
	}
	const { mapped, unmapped, duplicates } = result;

	const map = relative(io.cwd, stationFile(io.cwd, station.name)).replaceAll("\\", "/");
	io.out(`Station: ${stationLabel(station.name, io.color)}`);
	io.out(`  chips: ${station.dir}`);
	io.out(`  map:   ${map}${mapped.length === 0 ? " (none yet)" : ""}`);

	if (mapped.length > 0) {
		io.out("\nMapped:");
		for (const chip of mapped) io.out(`  [${chip.id}] ${chip.label ?? "?"} -> ${chip.script}: ${chip.state}${describePerChip(chip.perChip)}`);
	}
	const withCode = unmapped.filter((chip) => chip.lines > 0);
	const empty = unmapped.filter((chip) => chip.lines === 0);
	if (withCode.length > 0) {
		io.out("\nNot mapped:");
		for (const chip of withCode) io.out(`  [${chip.id}] ${chip.label}: ${lines(chip.lines)}`);
	}
	if (empty.length > 0) io.out(`\nEmpty, not mapped: ${empty.map((chip) => `[${chip.id}] ${chip.label}`).join(", ")}`);

	if (duplicates.length > 0) {
		io.out("\nSeveral files for one chip. The IC10Sync mod only uses the one with the chip's label now;");
		io.out("delete the others, or run this in a terminal to choose:");
		for (const duplicate of duplicates) {
			io.out(`  [${duplicate.id}]`);
			for (const line of describeFiles(duplicate)) io.out(`    ${line}`);
		}
		return 1;
	}
	return 0;
}

/** What the commands' options parse to. */
interface Options {
	/** `--chipdata <folder>`. */
	chipdata?: string;
	/** `--station <name>`. */
	station?: string;
	/** once, watch: false for `--no-tests`. */
	tests?: boolean;
}

/** The station `--chipdata` and `--station` pick. */
function stationFor(options: Options, io: CliIo): Station {
	const chipdata = findChipdata({ chipdata: options.chipdata, cwd: io.cwd, env: io.env, documents: io.documents });
	return findStation(chipdata, options.station);
}

/** once's and watch's pass over the station. */
function syncOptions(options: Options, io: CliIo): SyncOptions {
	const station = stationFor(options, io);
	return { root: io.cwd, station, log: io.out, tests: options.tests, findTests: io.findTests, runTests: io.runTests, color: io.color };
}

/** A command: its name and arguments, and what it does with them. */
interface CommandSpec {
	/** Its name and arguments, as commander reads them: `map <id> <script>`. */
	usage: string;
	description: string;
	/** It takes `--no-tests`. */
	tests?: boolean;
	/** False for a command that doesn't use a station, so it doesn't take `--chipdata` and `--station`. */
	station?: false;
	/** More about it, after its options in its `--help`. */
	about?: string;
	/** Runs it, with its arguments in order; returns the exit code. */
	run: (args: string[], options: Options, io: CliIo) => Promise<number>;
}

const COMMANDS: CommandSpec[] = [
	{
		usage: "status",
		description: "compares the station's chips with their scripts, and lists the chips not mapped yet",
		about: ABOUT_STATUS,
		run: async (_, options, io) => status(stationFor(options, io), io),
	},
	{
		usage: "map <id> <script>",
		description: "maps a chip to a script this project has",
		about: ABOUT_MAP,
		run: async ([id, script], options, io) => {
			const station = stationFor(options, io);
			const chip = chipId(id!);
			const path = scriptPath(io.cwd, io.cwd, script!);
			reportMapped(chip, path, mapChip(io.cwd, station, chip, path), io);
			return 0;
		},
	},
	{
		usage: "adopt <id> <script>",
		description: "copies a chip's code from the game into a new script, and maps the chip to it",
		about: ABOUT_MAP,
		run: async ([id, script], options, io) => {
			const station = stationFor(options, io);
			const chip = chipId(id!);
			const path = scriptPath(io.cwd, io.cwd, script!);
			const result = adoptChip(io.cwd, station, chip, path);
			io.out(`Copied [${chip}] ${result.chip?.label}'s code to ${path} (${lines(result.lines)})`);
			reportMapped(chip, path, result, io);
			return 0;
		},
	},
	{
		usage: "unmap <id>",
		description: "takes a chip out of the map",
		about: ABOUT_MAP,
		run: async ([id], options, io) => {
			const station = stationFor(options, io);
			const chip = chipId(id!);
			io.out(`Unmapped [${chip}] (was ${unmapChip(io.cwd, station, chip)})`);
			return 0;
		},
	},
	{
		usage: "once",
		description: "sends each changed script to its chips, if it has no lint errors and its tests pass, and copies each chip edited in game back to its script",
		tests: true,
		about: ABOUT_SYNC,
		run: async (_, options, io) => {
			const sync = syncOptions(options, io);
			const outcomes = await syncOnce(sync);
			if (outcomes.length === 0) io.out(`No chips mapped in ${sync.station.name} yet: see ic10-link map and adopt.`);
			return outcomes.some((outcome) => outcome.kind === "blocked" || outcome.failed) ? 1 : 0;
		},
	},
	{
		usage: "watch",
		description: "does the same whenever a script, a test, a map or a chip changes, until Ctrl+C (in the REPL, until stop)",
		tests: true,
		about: ABOUT_SYNC,
		run: async (_, options, io) => {
			// Each line with its time, as the game's console has it, to match the two up.
			const log = (line: string) => io.out(`${new Date().toTimeString().slice(0, 8)} ${line}`);
			await watch({ ...syncOptions(options, io), log, signal: io.signal, stopWith: io.stopWith });
			return 0;
		},
	},
	{
		usage: "per-chip <script> <names...>",
		description: "makes defines per-chip, listed in <script>.json beside the script: each chip keeps its own value",
		station: false,
		about: ABOUT_PER_CHIP,
		run: async ([script, ...names], _, io) => {
			const path = scriptPath(io.cwd, io.cwd, script!);
			const file = resolve(io.cwd, path);
			if (!existsSync(file)) throw new Error(`${path}: no such script`);
			const text = gameText(readFileSync(file, "utf8"));
			const already = perChipNames(file, text);
			const asked = [...new Set(names)];
			for (const name of asked.filter((name) => already.includes(name))) io.out(`${name}: already per-chip`);
			const added = addPerChipNames(file, asked.filter((name) => !already.includes(name)));
			if (added.length > 0) io.out(`${path}.json: ${added.join(", ")} now per-chip`);
			const defined = defineValues(text, added);
			for (const name of added.filter((name) => !defined.has(name))) io.out(`${name} isn't defined in ${path} yet; it's per-chip once it is.`);
			return 0;
		},
	},
	{
		usage: "repl",
		description: "a prompt to run these commands one after another, with watch in the background",
		run: async (_, options, io) => {
			if (!io.terminal) {
				io.out("repl needs a terminal to read from.");
				return 2;
			}
			const others = COMMANDS.filter((spec) => !spec.usage.startsWith("repl"));
			const name = (spec: CommandSpec) => spec.usage.split(" ")[0]!;
			return repl(io, {
				terminal: io.terminal,
				run: runCli,
				commands: others.map(name),
				withStation: others.filter((spec) => spec.station !== false).map(name),
				defaults: { chipdata: options.chipdata, station: options.station },
			});
		},
	},
];

/** Run the command line; returns the exit code. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
	return runProgram("ic10-link", argv, io.out, (program, exit) => {
		program.usage("<command> [options]").addHelpText("after", `\n${ABOUT}`);
		for (const spec of COMMANDS) {
			const command = program.command(spec.usage).description(spec.description);
			if (spec.station !== false) {
				command
					.option("--chipdata <folder>", `the IC10Sync mod's folder (default: ${CHIPDATA_ENV}, else <Documents>\\My Games\\Stationeers\\chipdata)`)
					.option("--station <name>", "the station (default: the one played most recently)");
			}
			if (spec.tests) command.option("--no-tests", "check lint only, without running tests");
			if (spec.about) command.addHelpText("after", `\n${spec.about}`);
			// A last argument like `<names...>` comes as a list: its words follow the others.
			command.action(async () => exit(await spec.run(command.processedArgs.flat(), command.opts<Options>(), io)));
		}
	});
}
