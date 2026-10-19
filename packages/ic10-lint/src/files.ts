import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isPattern, type LintConfig, overrideFor, overrideMatches, projectRelative } from "./config.ts";
import { type LintOptions, lint } from "./lint.ts";
import { perChipFile, readPerChipFile } from "./per-chip.ts";
import type { BatchOpCatalog, Finding } from "./types.ts";

export interface FileReport {
	/** Relative to the project, with forward slashes. */
	path: string;
	file: string;
	findings: Finding[];
}

/**
 * Every `.ic10` file under `dir`, recursively, as sorted absolute paths. Skips `node_modules` and
 * folders whose name starts with `.`, so `"dir": "."` doesn't search installed packages or `.git`.
 */
export function findScripts(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(resolve(dir), entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules" && !entry.name.startsWith(".")) out.push(...findScripts(full));
		}
		else if (entry.name.endsWith(".ic10")) out.push(full);
	}
	return out.sort();
}

/** The blocks a script's per-script file declares, or why it can't be read; undefined with no such file. */
function perChipOptions(file: string, path: string): LintOptions["perChip"] {
	if (!existsSync(perChipFile(file))) return undefined;
	try {
		return { blocks: readPerChipFile(perChipFile(file), perChipFile(path)).blocks };
	} catch (error) {
		return { error: (error as Error).message };
	}
}

/** Lint one file with the project's config: its rules, the file's override if it has one, and its per-script file's blocks. */
export async function lintFile(file: string, config: LintConfig, catalog?: BatchOpCatalog): Promise<FileReport> {
	const path = projectRelative(config.root, file);
	const override = overrideFor(config, path);
	const findings = await lint(readFileSync(resolve(config.root, file), "utf8"), {
		catalog,
		rules: { ...config.rules, ...override?.rules },
		override,
		perChip: perChipOptions(resolve(config.root, file), path),
	});
	return { path, file: resolve(config.root, file), findings };
}

/** Lint the given files (or folders, searched for `.ic10` files) with the project's config. */
export async function lintFiles(paths: string[], config: LintConfig, catalog?: BatchOpCatalog): Promise<FileReport[]> {
	const files = paths.flatMap((p) => {
		const full = resolve(config.root, p);
		return p.endsWith(".ic10") ? [full] : findScripts(full);
	});
	const reports: FileReport[] = [];
	for (const file of files) reports.push(await lintFile(file, config, catalog));
	return reports;
}

/**
 * Lint every script in the config's `dir`. An override for a script that isn't there, or a pattern
 * that matches none, is reported against that path, so it gets removed.
 */
export async function lintProject(config: LintConfig, catalog?: BatchOpCatalog): Promise<FileReport[]> {
	const reports = await lintFiles([config.dir], config, catalog);
	for (const path of Object.keys(config.overrides)) {
		if (reports.some((r) => overrideMatches(path, r.path))) continue;
		const file = resolve(config.root, path);
		reports.push({
			path,
			file,
			findings: [
				{
					rule: "config",
					severity: "error",
					line: 0,
					column: 0,
					message: isPattern(path)
						? `the override's pattern matches no script in "${projectRelative(config.root, config.dir)}"; remove it`
						: existsSync(file)
							? `the override is for a script outside "${projectRelative(config.root, config.dir)}"`
							: "the override is for a script that doesn't exist; remove it",
					text: "",
				},
			],
		});
	}
	return reports;
}
