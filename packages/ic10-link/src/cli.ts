import { rmSync } from "node:fs";
import { basename, relative } from "node:path";
import { Command, CommanderError } from "commander";
import { CHIPDATA_ENV, type FindOptions, findChipdata, findStation, type Station } from "./game/chipdata.ts";
import { adoptChip, chipId, type MapResult, mapChip, unmapChip } from "./project/mapping.ts";
import { scriptPath, stationFile } from "./project/stations.ts";
import type { GateOptions } from "./sync/gate.ts";
import { type Duplicate, stationStatus } from "./sync/status.ts";
import { type SyncOptions, stationLabel, syncOnce } from "./sync/sync.ts";
import { watch } from "./watch/watch.ts";

/** After the list of commands in `ic10-link --help`. */
const ABOUT = `A station's map, stations/<station>.json, says which chip runs which of this project's scripts.
A chip's id is the number in brackets in its file's name: 450 for "Script1 [450].ic10".

A script's tests are the test files that name it; they run with the project's Vitest.
A chip edited in game is copied to its script, then checked: the result is reported, not enforced.
If a chip and its script were both changed, the script is sent, and the chip's code is kept in
.ic10-link/preserved/<station>/conflicts/. once exits 1 if anything failed its checks.

A chip relabelled in game has a file for each label, and the IC10Sync mod only uses the one with
its current label. In a terminal, status asks which one that is, and deletes the others.
Otherwise it lists them, and the exit code is 1.`;

export interface CliIo extends Pick<GateOptions, "findTests" | "runTests"> {
	/** The project: where stations/ is. */
	cwd: string;
	out: (text: string) => void;
	/** Asks the player a question and returns their answer. Only in an interactive terminal. */
	ask?: (question: string) => Promise<string>;
	env?: NodeJS.ProcessEnv;
	/** The Documents folder; for tests. Default reads Windows' registry. */
	documents?: FindOptions["documents"];
	/** Stops `watch`. */
	signal?: AbortSignal;
	/** Colour the output (ic10-lint's `wantsColor()`). Default off. */
	color?: boolean;
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

function describeFiles(duplicate: Duplicate, numbered: boolean): string[] {
	const width = Math.max(...duplicate.files.map((file) => basename(file.path).length));
	return duplicate.files.map((file, i) => {
		const size = file.lines === 0 ? "empty" : lines(file.lines);
		return `  ${numbered ? `${i + 1}) ` : "  "}${basename(file.path).padEnd(width)}  modified ${formatTime(file.modified)}, ${size}`;
	});
}

/** Asks which of a chip's files is current, and deletes the others. False if the player skips it. */
async function resolveDuplicate(duplicate: Duplicate, ask: NonNullable<CliIo["ask"]>, io: CliIo): Promise<boolean> {
	const count = duplicate.files.length;
	io.out(`\nChip ${duplicate.id} has ${count} files. The IC10Sync mod only uses the one with the chip's label now:`);
	for (const line of describeFiles(duplicate, true)) io.out(line);
	for (;;) {
		const answer = (await ask(`Which one is current? The others are deleted. [1-${count}, Enter to skip]: `)).trim();
		if (answer === "") return false;
		const choice = Number(answer);
		if (Number.isInteger(choice) && choice >= 1 && choice <= count) {
			for (const [i, file] of duplicate.files.entries()) {
				if (i === choice - 1) continue;
				rmSync(file.path);
				io.out(`  deleted ${basename(file.path)}`);
			}
			return true;
		}
	}
}

/** What `map` and `adopt` say about the chip once it's mapped. */
function reportMapped(id: string, script: string, result: MapResult, io: CliIo): void {
	io.out(`Mapped [${id}] ${result.chip?.label ?? "?"} -> ${script}${result.previous ? ` (was ${result.previous})` : ""}`);
	if (result.files === 0) io.out(`The game has no file for chip ${id} yet. It writes one once the station is loaded with the chip in it.`);
	if (result.files > 1) io.out(`Chip ${id} has ${result.files} files. Run ic10-link status to choose the current one.`);
}

async function status(station: Station, io: CliIo): Promise<number> {
	let result = stationStatus(io.cwd, station);
	if (io.ask && result.duplicates.length > 0) {
		for (const duplicate of result.duplicates) await resolveDuplicate(duplicate, io.ask, io);
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
		for (const chip of mapped) io.out(`  [${chip.id}] ${chip.label ?? "?"} -> ${chip.script}: ${chip.state}`);
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
			for (const line of describeFiles(duplicate, false)) io.out(`  ${line}`);
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
	/** Runs it, with its arguments in order; returns the exit code. */
	run: (args: string[], options: Options, io: CliIo) => Promise<number>;
}

const COMMANDS: CommandSpec[] = [
	{
		usage: "status",
		description: "compares the station's chips with their scripts, and lists the chips not mapped yet",
		run: async (_, options, io) => status(stationFor(options, io), io),
	},
	{
		usage: "map <id> <script>",
		description: "maps a chip to a script this project has",
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
		run: async (_, options, io) => {
			const sync = syncOptions(options, io);
			const outcomes = await syncOnce(sync);
			if (outcomes.length === 0) io.out(`No chips mapped in ${sync.station.name} yet: see ic10-link map and adopt.`);
			return outcomes.some((outcome) => outcome.kind === "blocked" || outcome.failed) ? 1 : 0;
		},
	},
	{
		usage: "watch",
		description: "does the same whenever a script, a test, a map or a chip changes, until Ctrl+C",
		tests: true,
		run: async (_, options, io) => {
			// Each line with its time, as the game's console has it, to match the two up.
			const log = (line: string) => io.out(`${new Date().toTimeString().slice(0, 8)} ${line}`);
			await watch({ ...syncOptions(options, io), log, signal: io.signal });
			return 0;
		},
	},
];

/** The command line, for commander; `onExit` gets the exit code of the command that ran. */
function program(io: CliIo, onExit: (code: number) => void): Command {
	// Commander ends what it writes with a newline, and io.out adds one.
	const write = (text: string) => io.out(text.replace(/\n$/, ""));
	// Set before the commands are added, so they have it too.
	const program = new Command("ic10-link")
		.usage("<command> [options]")
		.addHelpText("after", `\n${ABOUT}`)
		.configureOutput({ writeOut: write, writeErr: write })
		.showHelpAfterError()
		.exitOverride();
	for (const spec of COMMANDS) {
		const command = program
			.command(spec.usage)
			.description(spec.description)
			.option("--chipdata <folder>", `the IC10Sync mod's folder (default: ${CHIPDATA_ENV}, else <Documents>\\My Games\\Stationeers\\chipdata)`)
			.option("--station <name>", "the station (default: the one played most recently)");
		if (spec.tests) command.option("--no-tests", "check lint only, without running tests");
		command.action(async () => onExit(await spec.run(command.processedArgs, command.opts<Options>(), io)));
	}
	return program;
}

/** Run the command line; returns the exit code. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
	let code = 0;
	try {
		await program(io, (exit) => (code = exit)).parseAsync(argv, { from: "user" });
		return code;
	} catch (error) {
		// Commander has said what was wrong: 0 for --help, else a bad command line.
		if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
		io.out((error as Error).message);
		return 2;
	}
}
