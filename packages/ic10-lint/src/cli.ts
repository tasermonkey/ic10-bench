import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { styleText } from "node:util";
import { loadConfig } from "./config.ts";
import { type FileReport, lintFiles, lintProject } from "./files.ts";
import { initConfig } from "./init.ts";
import { atLeast } from "./lint.ts";
import { RULES } from "./rules/index.ts";
import type { BatchOpCatalog, Severity } from "./types.ts";

/** The usage, for the command named `name` (`ic10-bench lint` runs this too). */
export const usageText = (name = "ic10-lint") => `Usage: ${name} [<folder> | <file.ic10> ...] [options]
       ${name} init [--dir <folder>] [--config <file>] [--force] [--no-links]

Checks IC10 scripts without running them. With no paths, checks the "dir" in ic10-lint.json
(default ic10/).

init writes a recommended ic10-lint.json: every rule at its default severity, and an override for
each script in --dir (default ic10) already over a game limit, so it can stay that size but not
grow. --force replaces a config that's there.

Options:
  --config <file>              the config (default: ic10-lint.json in the current folder)
  --catalog <file>             a device catalogue (JSON with "prefabs"), for batch-ops and mods' names
                               in hash-name; default: .ic10-bench/catalog.json if IC10 Bench built one
  --fail-on <error | warning>  exit 1 if anything is at least this bad (default: error)
  --format <text | json>       text: file:line:col severity rule message (1-based); json: the findings
  --no-links                   in a terminal, don't make the paths clickable links (keeps the colours)
  --help                       this, and the rules

Colours and links are on in a terminal and off in a pipe; NO_COLOR=1 or FORCE_COLOR=1 overrides.

Rules:
${RULES.map((r) => `  ${r.id.padEnd(26)} ${r.description}`).join("\n")}`;

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

function init(argv: string[], io: CliIo, usage: string): number {
	const options: Record<string, string> = {};
	let force = false;
	let links = io.links ?? io.color ?? false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--force") force = true;
		else if (arg === "--no-links") links = false;
		else if (["--dir", "--config"].includes(arg) && argv[i + 1] !== undefined) options[arg.slice(2)] = argv[++i]!;
		else {
			io.out(`${arg}: init takes --dir <folder>, --config <file>, --force and --no-links\n\n${usage}`);
			return 2;
		}
	}
	try {
		const { file, config } = initConfig(io.cwd, { dir: options.dir, file: options.config, force });
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
	} catch (error) {
		io.out((error as Error).message);
		return 2;
	}
}

/** Run the command line; returns the exit code. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
	const usage = usageText(io.name);
	if (argv[0] === "init") return init(argv.slice(1), io, usage);
	const paths: string[] = [];
	const options: Record<string, string> = {};
	let links = io.links ?? io.color ?? false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--help" || arg === "-h") {
			io.out(usage);
			return 0;
		}
		if (arg === "--no-links") links = false;
		else if (arg.startsWith("--")) {
			const value = argv[++i];
			if (!["--config", "--catalog", "--fail-on", "--format"].includes(arg) || value === undefined) {
				io.out(`${arg}: unknown option, or no value\n\n${usage}`);
				return 2;
			}
			options[arg.slice(2)] = value;
		} else paths.push(arg);
	}
	const failOn = (options["fail-on"] ?? "error") as Severity;
	const format = options.format ?? "text";
	if (!["error", "warning"].includes(failOn) || !["text", "json"].includes(format)) {
		io.out(`--fail-on takes error or warning, --format text or json\n\n${usage}`);
		return 2;
	}

	try {
		const config = loadConfig(io.cwd, options.config);
		const fallback = join(config.root, ".ic10-bench", "catalog.json");
		const catalogFile = options.catalog ? resolve(io.cwd, options.catalog) : existsSync(fallback) && !io.catalog ? fallback : undefined;
		const catalog = catalogFile ? readCatalog(catalogFile) : io.catalog;
		const reports =
			paths.length > 0 ? await lintFiles(paths.map((p) => resolve(io.cwd, p)), config, catalog) : await lintProject(config, catalog);

		if (format === "json") io.out(JSON.stringify(reports.map(({ path, findings }) => ({ path, findings })), null, 2));
		else io.out(formatText(reports, false, painter(io.color), links).join("\n"));
		return reports.some((r) => r.findings.some((f) => atLeast(f.severity, failOn))) ? 1 : 0;
	} catch (error) {
		io.out((error as Error).message);
		return 2;
	}
}
