import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { styleText } from "node:util";
import { Option } from "commander";
import { loadConfig } from "./config.ts";
import { type FileReport, lintFiles, lintProject } from "./files.ts";
import { initConfig } from "./init.ts";
import { atLeast } from "./lint.ts";
import { runProgram } from "./program.ts";
import { RULES } from "./rules/index.ts";
import type { BatchOpCatalog, Severity } from "./types.ts";

/** After the options in `--help`. */
const ABOUT = () => `Colours and links are on in a terminal and off in a pipe; NO_COLOR=1 or FORCE_COLOR=1 overrides.

Rules:
${RULES.map((r) => `  ${r.id.padEnd(26)} ${r.description}`).join("\n")}`;

/** After the options in `init --help`. */
const ABOUT_INIT = `Every rule is at its default severity, and each script in --dir already over a game limit gets an
override, so it can stay that size but not grow. --force replaces a config that's there.`;

/** What the command line's options parse to. */
interface Options {
	config?: string;
	catalog?: string;
	failOn: Severity;
	format: "text" | "json";
	/** False for `--no-links`. */
	links: boolean;
	/** init. */
	dir?: string;
	/** init. */
	force?: boolean;
}

export interface CliIo {
	cwd: string;
	out: (text: string) => void;
	/** The catalogue to use when there's no `--catalog` (IC10 Bench passes the project's, mods included). */
	catalog?: BatchOpCatalog;
	/** The command's name in messages. Default `ic10-lint`. */
	name?: string;
	/** Colour the text output (see `wantsColor()`). Default off. */
	color?: boolean;
	/** Make each script's path a terminal hyperlink to the file (OSC 8). Default: on with `color`; `--no-links` turns it off. */
	links?: boolean;
}

/** A catalogue file, as IC10 Bench writes it (or anything with `prefabs`). */
export function readCatalog(file: string): BatchOpCatalog {
	const json = JSON.parse(readFileSync(file, "utf8"));
	if (typeof json?.prefabs !== "object") throw new Error(`${file}: not a device catalogue (no "prefabs")`);
	return json;
}

/** Where IC10 Bench (`ic10-bench catalog`) writes a project's device catalogue, relative to the project. */
export const PROJECT_CATALOG = ".ic10-bench/catalog.json";

/** The project's catalogue, if IC10 Bench has built one. */
export function projectCatalog(root: string): BatchOpCatalog | undefined {
	const file = join(root, PROJECT_CATALOG);
	return existsSync(file) ? readCatalog(file) : undefined;
}

/**
 * Whether to colour output to `stream`: FORCE_COLOR if it's set, else a terminal with colours
 * (which `hasColors()` says no to under NO_COLOR). Pipes and files get plain text.
 */
export function wantsColor(stream: NodeJS.WriteStream = process.stdout): boolean {
	const force = process.env.FORCE_COLOR;
	if (force !== undefined && force !== "") return force !== "0" && force !== "false";
	return stream.isTTY === true && stream.hasColors();
}

type Paint = (style: Parameters<typeof styleText>[0], text: string) => string;

const painter =
	(color: boolean | undefined): Paint =>
	(style, text) =>
		color ? styleText(style, text, { validateStream: false }) : text;

/**
 * `text` as a terminal hyperlink (OSC 8) to `file`, at the line and column if given, so a click
 * opens it even when the path has spaces (VS Code and Windows Terminal follow these). As it is
 * when `on` is false. The position is `#line:col`: VS Code reads it with its terminal link-suffix
 * pattern, which takes `#7:7` but not the `#7,7` its editor URIs use.
 */
export function fileLink(on: boolean, file: string, text: string, line?: number, column?: number): string {
	if (!on) return text;
	const at = line === undefined ? "" : `#${line}${column === undefined ? "" : `:${column}`}`;
	return `\u001b]8;;${pathToFileURL(file).href}${at}\u001b\\${text}\u001b]8;;\u001b\\`;
}

const SEVERITY_STYLE = { error: "red", warning: "yellow", info: "blue" } as const;

function formatText(reports: FileReport[], showSkips: boolean, paint: Paint, links: boolean): string[] {
	const lines: string[] = [];
	let skipped = false;
	for (const { path, file, findings } of reports) {
		for (const f of findings) {
			if (f.message.startsWith("skipped:") && !showSkips) {
				skipped = true;
				continue;
			}
			const where = fileLink(
				links,
				file,
				`${paint(["bold", "cyan"], path)}${paint("dim", `:${f.line + 1}:${f.column + 1}`)}`,
				f.line + 1,
				f.column + 1,
			);
			lines.push(`${where} ${paint(SEVERITY_STYLE[f.severity], f.severity)} ${paint("dim", f.rule)} ${f.message}`);
		}
	}
	if (skipped) lines.push(paint("dim", "(batch-ops was skipped: no device catalogue; pass --catalog)"));
	const count = (s: Severity) => reports.reduce((n, r) => n + r.findings.filter((f) => f.severity === s).length, 0);
	const errors = count("error");
	const warnings = count("warning");
	lines.push(
		`${paint(errors > 0 ? ["bold", "red"] : "green", `${errors} errors`)}, ` +
			`${paint(warnings > 0 ? "yellow" : "green", `${warnings} warnings`)} in ${reports.length} scripts`,
	);
	return lines;
}

/** `init`: writes a recommended config, and lists the overrides it made; returns the exit code. */
function init(options: Options, io: CliIo): number {
	const links = options.links && (io.links ?? io.color ?? false);
	const { file, config } = initConfig(io.cwd, { dir: options.dir, file: options.config, force: options.force });
	const overrides = Object.entries(config.overrides);
	io.out(`Wrote ${file}`);
	if (overrides.length === 0) io.out("No script is over the game's limits.");
	else {
		io.out(`Overrides for the ${overrides.length} scripts over the game's limits (they may shrink but not grow):`);
		for (const [path, { limits }] of overrides) {
			const name = fileLink(links, resolve(dirname(file), path), painter(io.color)(["bold", "cyan"], path));
			io.out(`  ${name}: ${Object.entries(limits).map(([limit, n]) => `${limit} ${n}`).join(", ")}`);
		}
	}
	return 0;
}

/** Lints the paths, or the config's `dir` with none; returns the exit code. */
async function lint(paths: string[], options: Options, io: CliIo): Promise<number> {
	const links = options.links && (io.links ?? io.color ?? false);
	const config = loadConfig(io.cwd, options.config);
	const fallback = join(config.root, PROJECT_CATALOG);
	const catalogFile = options.catalog ? resolve(io.cwd, options.catalog) : existsSync(fallback) && !io.catalog ? fallback : undefined;
	const catalog = catalogFile ? readCatalog(catalogFile) : io.catalog;
	const reports = paths.length > 0 ? await lintFiles(paths.map((p) => resolve(io.cwd, p)), config, catalog) : await lintProject(config, catalog);

	if (options.format === "json") io.out(JSON.stringify(reports.map(({ path, findings }) => ({ path, findings })), null, 2));
	else io.out(formatText(reports, false, painter(io.color), links).join("\n"));
	return reports.some((r) => r.findings.some((f) => atLeast(f.severity, options.failOn))) ? 1 : 0;
}

const NO_LINKS = "in a terminal, don't make the paths clickable links (keeps the colours)";

/** Run the command line; returns the exit code. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
	return runProgram(io.name ?? "ic10-lint", argv, io.out, (program, exit) => {
		program
			.description('Checks IC10 scripts without running them. With no paths, checks the "dir" in ic10-lint.json (default ic10/).')
			// The checks' options are for them alone: init has its own --config and --no-links.
			.enablePositionalOptions()
			.argument("[paths...]", "folders or .ic10 files to check")
			.option("--config <file>", "the config (default: ic10-lint.json in the current folder)")
			.option(
				"--catalog <file>",
				'a device catalogue (JSON with "prefabs"), for batch-ops and mods\' names in hash-name; default: .ic10-bench/catalog.json if IC10 Bench built one',
			)
			.addOption(new Option("--fail-on <severity>", "exit 1 if anything is at least this bad").choices(["error", "warning"]).default("error"))
			.addOption(
				new Option("--format <format>", "text: file:line:col severity rule message (1-based); json: the findings").choices(["text", "json"]).default("text"),
			)
			.option("--no-links", NO_LINKS)
			.addHelpText("after", `\n${ABOUT()}`)
			.action(async (paths: string[]) => exit(await lint(paths, program.opts<Options>(), io)));
		const command = program
			.command("init")
			.description("writes a recommended ic10-lint.json")
			.option("--dir <folder>", "the scripts' folder (default: ic10)")
			.option("--config <file>", "where to write it (default: ic10-lint.json in the current folder)")
			.option("--force", "replace a config that's there")
			.option("--no-links", NO_LINKS)
			.addHelpText("after", `\n${ABOUT_INIT}`)
			.action(() => exit(init(command.opts<Options>(), io)));
	});
}
