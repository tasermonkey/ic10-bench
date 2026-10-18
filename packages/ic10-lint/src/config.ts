/**
 * The project's `ic10-lint.json`, read by the CLI and by IC10 Bench's `describeScriptChecks()`:
 *
 *   {
 *     "dir": "ic10",
 *     "rules": { "unused": "off", "register-flow": "info" },
 *     "overrides": {
 *       "ic10/Big Script.ic10": { "reason": "over the limits; trim later", "limits": { "lines": 161 } },
 *       "ic10/Audit/**": { "reason": "fail in game on purpose", "rules": { "validate": "off" } }
 *     }
 *   }
 *
 * A key with a `*` is a pattern, for every script it matches; it sets rules only, since limits are
 * one script's allowance.
 *
 * It's a file rather than comments in the scripts, because a comment costs a script lines and bytes.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { GAME_LIMITS, type LimitName, type LimitOverride } from "./limits.ts";
import type { SeveritySetting } from "./types.ts";

export const CONFIG_FILE = "ic10-lint.json";

export interface FileOverride extends LimitOverride {
	/** Severities for this script only, over the project's. */
	rules?: Record<string, SeveritySetting>;
}

export interface LintConfig {
	/** The project's folder: paths in the config are relative to it. */
	root: string;
	/** The config file, if there is one. */
	file?: string;
	/** The scripts' folder, absolute (default: `ic10` in the project). */
	dir: string;
	rules: Record<string, SeveritySetting>;
	/** By script path relative to `root`, with forward slashes, or a pattern (`isPattern`); `overrideFor` finds a script's. */
	overrides: Record<string, FileOverride>;
}

const SEVERITIES = new Set(["error", "warning", "warn", "info", "off"]);

function fail(file: string, message: string): never {
	throw new Error(`${file}: ${message}`);
}

function checkRules(file: string, where: string, rules: unknown): Record<string, SeveritySetting> {
	if (rules === undefined) return {};
	if (typeof rules !== "object" || rules === null) fail(file, `${where} must be an object of rule ids to severities`);
	for (const [id, severity] of Object.entries(rules)) {
		if (!SEVERITIES.has(severity as string)) fail(file, `${where}.${id} must be one of error, warn, info, off`);
	}
	return rules as Record<string, SeveritySetting>;
}

/** A path relative to the project, with forward slashes, as the config's `overrides` keys are. */
export function projectRelative(root: string, path: string): string {
	return relative(root, resolve(root, path)).replaceAll("\\", "/");
}

/**
 * Whether an `overrides` key is a pattern (`ic10/Audit/**`) rather than one script's path. Only a
 * `*` makes one, since script names can have brackets: `Air [7335].ic10`.
 */
export function isPattern(key: string): boolean {
	return key.includes("*");
}

/** Whether an `overrides` key is for the script at `path` (relative to the project, with `/`). */
export function overrideMatches(key: string, path: string): boolean {
	return isPattern(key) ? posix.matchesGlob(path, key) : key === path;
}

/**
 * The script's override, at `path` (relative to the project, with `/`): the rules of every pattern
 * that matches it, in the config's order, then its own entry's, each over those before. The reason
 * and limits are its own entry's, if it has one.
 */
export function overrideFor(config: LintConfig, path: string): FileOverride | undefined {
	const own = config.overrides[path];
	const patterns = Object.entries(config.overrides)
		.filter(([key]) => isPattern(key) && overrideMatches(key, path))
		.map(([, override]) => override);
	if (patterns.length === 0) return own;
	return { ...patterns[0]!, ...own, rules: Object.assign({}, ...patterns.map((p) => p.rules), own?.rules) };
}

/**
 * Read `ic10-lint.json` from the project's folder (or `file`, if given). Without one, every rule
 * has its default severity and the scripts are in `ic10/`.
 */
export function loadConfig(root: string = process.cwd(), file?: string): LintConfig {
	const path = file ? resolve(root, file) : join(resolve(root), CONFIG_FILE);
	const base = file ? resolve(path, "..") : resolve(root);
	if (!existsSync(path)) {
		if (file) throw new Error(`${path}: no such file`);
		return { root: base, dir: join(base, "ic10"), rules: {}, overrides: {} };
	}
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		fail(path, `not valid JSON (${(error as Error).message})`);
	}
	const dir = json.dir ?? "ic10";
	if (typeof dir !== "string") fail(path, '"dir" must be a folder name');

	const overrides: Record<string, FileOverride> = {};
	const given = json.overrides ?? {};
	if (typeof given !== "object" || given === null) fail(path, '"overrides" must be an object of script paths');
	for (const [script, value] of Object.entries(given)) {
		const where = `overrides["${script}"]`;
		const override = value as FileOverride;
		if (typeof override?.reason !== "string" || !override.reason) fail(path, `${where} needs a "reason"`);
		if (isPattern(script) && override.limits !== undefined) fail(path, `${where} is a pattern: limits are for one script, so a pattern sets rules only`);
		for (const [limit, n] of Object.entries(override.limits ?? {})) {
			if (!(limit in GAME_LIMITS)) fail(path, `${where}.limits.${limit}: the limits are lines, columns and bytes`);
			if (!Number.isInteger(n) || n <= GAME_LIMITS[limit as LimitName]) {
				fail(path, `${where}.limits.${limit} must be a whole number over the game's ${GAME_LIMITS[limit as LimitName]}`);
			}
		}
		overrides[projectRelative(base, script)] = { ...override, rules: checkRules(path, `${where}.rules`, override.rules) };
	}
	return {
		root: base,
		file: path,
		dir: isAbsolute(dir) ? dir : join(base, dir),
		rules: checkRules(path, '"rules"', json.rules),
		overrides,
	};
}
