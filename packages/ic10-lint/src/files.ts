import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type LintConfig, projectRelative } from "./config.ts";
import { lint } from "./lint.ts";
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

/** Lint one file with the project's config: its rules, and the file's override if it has one. */
export async function lintFile(file: string, config: LintConfig, catalog?: BatchOpCatalog): Promise<FileReport> {
	const path = projectRelative(config.root, file);
	const override = config.overrides[path];
	const findings = await lint(readFileSync(resolve(config.root, file), "utf8"), {
		catalog,
		rules: { ...config.rules, ...override?.rules },
		override,
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
 * Lint every script in the config's `dir`. An override for a script that isn't there is reported
 * against that path, so it gets removed.
 */
export async function lintProject(config: LintConfig, catalog?: BatchOpCatalog): Promise<FileReport[]> {
	const reports = await lintFiles([config.dir], config, catalog);
	const seen = new Set(reports.map((r) => r.path));
	for (const path of Object.keys(config.overrides)) {
		if (seen.has(path)) continue;
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
					message: existsSync(file)
						? `the override is for a script outside "${projectRelative(config.root, config.dir)}"`
						: "the override is for a script that doesn't exist; remove it",
					text: "",
				},
			],
		});
	}
	return reports;
}
