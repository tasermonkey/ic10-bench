#!/usr/bin/env node
/**
 * The ic10-bench command line, run in a project's folder (or with --project, or IC10_BENCH_ROOT):
 *
 *   ic10-bench init [<file.ic10> ...]      set up a folder of scripts for testing (package.json, Vitest, a test per script)
 *   ic10-bench catalog                     build the project's catalogue and ic10-bench-env.d.ts
 *   ic10-bench import-mods [<folder>]      read mods' devices from the Stationpedia export into ic10-mods/
 *   ic10-bench props <prefab | part of a name | hash>
 *   ic10-bench logic <logic type | part of one>
 *   ic10-bench lint [<paths>] [options]    @tasermonkey/ic10-lint, with the project's catalogue
 *
 * Lookups read the project's catalogue, or the packaged one if `catalog` hasn't been run.
 */
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { runCli, wantsColor } from "@tasermonkey/ic10-lint";
import { loadCatalog } from "../src/catalog/catalog.ts";
import { buildProjectCatalog } from "../src/cli/catalog.ts";
import { importMods, NoExportError } from "../src/cli/import-mods.ts";
import { type InitOptions, initProject, npmInstall } from "../src/cli/init.ts";
import { describeLogic, describePrefab, findLogicTypes, findPrefabs, listPrefabs } from "../src/cli/lookup.ts";
import { projectRoot, ROOT_ENV } from "../src/project.ts";

const USAGE = `Usage:
  ic10-bench init [<file.ic10> ...]                   set up this folder's scripts for testing: package.json,
                                                      Vitest, the packages, and a skeleton test per script
      --dir <folder>   where the scripts are (default: ic10/ if there is one, else this folder)
      --no-install     don't run npm install
      --no-tests       don't write skeleton tests
      --yes            don't ask before setting up in the game's own folder
  ic10-bench catalog                                  build this project's device catalogue and prefab types
  ic10-bench import-mods [<Stationpedia folder>]      read your mods' devices from the Stationpedia export
  ic10-bench props <prefab | part of a name | hash>   a prefab's logic types, modes and slots
  ic10-bench logic <logic type | part of one>          what a logic type is, and which prefabs have it
  ic10-bench lint [<folder | file.ic10> ...]          check scripts without running them (ic10-lint,
                                                      with this project's devices); --help for options

Options:
  --project <folder>   the project's folder (default: the current one)`;

function props(query: string): void {
	const catalog = loadCatalog();
	const found = findPrefabs(catalog, query);
	if (found.length === 1) console.log(describePrefab(catalog, found[0]!));
	else if (found.length === 0) {
		console.log(`No prefab matches "${query}".`);
		process.exitCode = 1;
	} else console.log(`${found.length} prefabs match "${query}":\n${listPrefabs(found)}`);
}

function logic(query: string): void {
	const catalog = loadCatalog();
	const exact = describeLogic(catalog, query);
	const found = exact ? [] : findLogicTypes(catalog, query);
	if (exact) console.log(exact);
	else if (found.length === 1) console.log(describeLogic(catalog, found[0]!));
	else if (found.length === 0) {
		console.log(`No logic type matches "${query}".`);
		process.exitCode = 1;
	} else console.log(`${found.length} logic types match "${query}":\n  ${found.join("\n  ")}`);
}

async function init(argv: string[]): Promise<number> {
	const major = Number(process.versions.node.split(".")[0]);
	if (major < 24) {
		console.log(`ic10-bench needs Node.js 24 or later; this is ${process.version}. Get it from https://nodejs.org/`);
		return 1;
	}
	const options: InitOptions = { scripts: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--dir" && argv[i + 1]) options.dir = argv[++i];
		else if (arg === "--no-install") options.install = false;
		else if (arg === "--no-tests") options.tests = false;
		else if (arg === "--yes" || arg === "-y") options.yes = true;
		else if (!arg.startsWith("-")) options.scripts!.push(arg);
		else {
			console.log(`${arg}: init takes <file.ic10> ..., --dir <folder>, --no-install, --no-tests and --yes\n\n${USAGE}`);
			return 1;
		}
	}
	if (!options.scripts!.length) delete options.scripts;
	const ask = process.stdin.isTTY
		? async (question: string) => {
				const prompt = createInterface({ input: process.stdin, output: process.stdout });
				const answer = await prompt.question(`${question} [y/N] `);
				prompt.close();
				return /^y(es)?$/i.test(answer.trim());
			}
		: undefined;
	const done = await initProject(projectRoot(), options, { out: (line) => console.log(line), ask, install: npmInstall });
	return done ? 0 : 1;
}

// process.exitCode rather than process.exit(): exiting while output is still being written
// crashes Node on Windows.
const args = process.argv.slice(2);
const projectFlag = args.indexOf("--project");
if (projectFlag >= 0) {
	const [, folder] = args.splice(projectFlag, 2);
	if (folder) process.env[ROOT_ENV] = resolve(folder);
}
const [command, ...rest] = args;
const query = rest.join(" ");
try {
	if (command === "init") process.exitCode = await init(rest);
	else if (command === "catalog") console.log((await buildProjectCatalog()).join("\n"));
	else if (command === "import-mods") console.log((await importMods(rest[0])).join("\n"));
	else if (command === "props" && query) props(query);
	else if (command === "logic" && query) logic(query);
	else if (command === "lint") {
		process.exitCode = await runCli(rest, {
			cwd: projectRoot(),
			out: (text) => console.log(text),
			catalog: loadCatalog(),
			name: "ic10-bench lint",
			color: wantsColor(),
		});
	}
	else {
		console.log(USAGE);
		process.exitCode = command === "--help" || command === "-h" ? 0 : 1;
	}
} catch (error) {
	if (!(error instanceof NoExportError)) throw error;
	console.error(error.message);
	process.exitCode = 1;
}
