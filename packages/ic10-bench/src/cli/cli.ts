/**
 * The ic10-bench command line, run in a project's folder (or with --project, or IC10_BENCH_ROOT).
 * On commander, set up as ic10-lint's and ic10-link's are (`runProgram`). Lookups read the
 * project's catalogue, or the packaged one if `catalog` hasn't been run.
 */
import { resolve } from "node:path";
import { runCli as runLint, runProgram } from "@tasermonkey/ic10-lint";
import { loadCatalog } from "../catalog/catalog.ts";
import { projectRoot } from "../project.ts";
import { buildProjectCatalog } from "./catalog.ts";
import { importMods, NoExportError } from "./import-mods.ts";
import { type InitIo, initProject, npmInstall } from "./init.ts";
import { describeLogic, describePrefab, findLogicTypes, findPrefabs, listPrefabs } from "./lookup.ts";

export interface CliIo {
	out: (text: string) => void;
	/** Asks a yes/no question (`init`, in the game's own folder); only in a terminal. */
	ask?: InitIo["ask"];
	/** Runs npm install for `init`. Default `npmInstall`. */
	install?: InitIo["install"];
	/** Colour `lint`'s output (ic10-lint's `wantsColor()`). Default off. */
	color?: boolean;
}

/** What the command line's options parse to. */
interface Options {
	project?: string;
	/** init. */
	dir?: string;
	/** init: false for `--no-install`. */
	install?: boolean;
	/** init: false for `--no-tests`. */
	tests?: boolean;
	/** init. */
	yes?: boolean;
}

/** `props`: a prefab's logic types, modes and slots, or the prefabs that match; 1 for none. */
function props(root: string, query: string, io: CliIo): number {
	const catalog = loadCatalog(root);
	const found = findPrefabs(catalog, query);
	if (found.length === 1) io.out(describePrefab(catalog, found[0]!));
	else if (found.length > 1) io.out(`${found.length} prefabs match "${query}":\n${listPrefabs(found)}`);
	else {
		io.out(`No prefab matches "${query}".`);
		return 1;
	}
	return 0;
}

/** `logic`: what a logic type is and which prefabs have it, or the logic types that match; 1 for none. */
function logic(root: string, query: string, io: CliIo): number {
	const catalog = loadCatalog(root);
	const exact = describeLogic(catalog, query);
	const found = exact ? [] : findLogicTypes(catalog, query);
	if (exact) io.out(exact);
	else if (found.length === 1) io.out(describeLogic(catalog, found[0]!)!);
	else if (found.length > 1) io.out(`${found.length} logic types match "${query}":\n  ${found.join("\n  ")}`);
	else {
		io.out(`No logic type matches "${query}".`);
		return 1;
	}
	return 0;
}

/** `init`: sets up the project's scripts for testing; 1 if it stopped. */
async function init(root: string, scripts: string[], options: Options, io: CliIo): Promise<number> {
	const major = Number(process.versions.node.split(".")[0]);
	if (major < 24) {
		io.out(`ic10-bench needs Node.js 24 or later; this is ${process.version}. Get it from https://nodejs.org/`);
		return 1;
	}
	const done = await initProject(
		root,
		{ scripts: scripts.length > 0 ? scripts : undefined, dir: options.dir, install: options.install, tests: options.tests, yes: options.yes },
		{ out: io.out, ask: io.ask, install: io.install ?? npmInstall },
	);
	return done ? 0 : 1;
}

/** Run the command line; returns the exit code. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
	return runProgram("ic10-bench", argv, io.out, (program, exit) => {
		/** The project: `--project`, else IC10_BENCH_ROOT, else the current folder. */
		const root = () => {
			const { project } = program.opts<Options>();
			return project ? resolve(project) : projectRoot();
		};
		program
			.usage("[--project <folder>] <command> [options]")
			.option("--project <folder>", "the project's folder (default: IC10_BENCH_ROOT, else the current one)")
			.addHelpText("after", "\nLookups read the project's catalogue, or the packaged one if catalog hasn't been run.");

		const initCommand = program
			.command("init")
			.description("set up this folder's scripts for testing: package.json, Vitest, the packages, and a skeleton test per script")
			.argument("[scripts...]", "the scripts to write tests for (default: every one in --dir)")
			.option("--dir <folder>", "where the scripts are (default: ic10/ if there is one, else this folder)")
			.option("--no-install", "don't run npm install")
			.option("--no-tests", "don't write skeleton tests")
			.option("-y, --yes", "don't ask before setting up in the game's own folder")
			.action(async (scripts: string[]) => exit(await init(root(), scripts, initCommand.opts<Options>(), io)));
		program
			.command("catalog")
			.description("build this project's device catalogue and prefab types")
			.action(async () => {
				io.out((await buildProjectCatalog(root())).join("\n"));
				exit(0);
			});
		program
			.command("import-mods")
			.description("read your mods' devices from the Stationpedia export")
			.argument("[folder]", "the Stationpedia export (default: the game's)")
			.action(async (folder?: string) => {
				try {
					io.out((await importMods(folder, root())).join("\n"));
					exit(0);
				} catch (error) {
					if (!(error instanceof NoExportError)) throw error;
					io.out(error.message);
					exit(1);
				}
			});
		program
			.command("props")
			.description("a prefab's logic types, modes and slots")
			.argument("<query...>", "a prefab, part of a name, or a hash")
			.action((query: string[]) => exit(props(root(), query.join(" "), io)));
		program
			.command("logic")
			.description("what a logic type is, and which prefabs have it")
			.argument("<query...>", "a logic type, or part of one")
			.action((query: string[]) => exit(logic(root(), query.join(" "), io)));
		// Everything after `lint` is ic10-lint's, its --help included.
		const lintCommand = program
			.command("lint")
			.description("check scripts without running them (ic10-lint, with this project's devices); lint --help for its options")
			.helpOption(false)
			.allowUnknownOption()
			.allowExcessArguments()
			.action(async () =>
				exit(await runLint(lintCommand.args, { cwd: root(), out: io.out, catalog: loadCatalog(root()), name: "ic10-bench lint", color: io.color })),
			);
	});
}
