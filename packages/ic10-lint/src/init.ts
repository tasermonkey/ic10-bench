/**
 * `ic10-lint init`: write a starting `ic10-lint.json`. It names every rule with its default
 * severity, so the config shows what can be changed, and gives each script that's already over a
 * game limit an override at its current size, so the project starts clean and can only shrink.
 * Its `$schema` (the package's schema.json) gives editors completion and checks.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { CONFIG_FILE, projectRelative } from "./config.ts";
import { findScripts } from "./files.ts";
import { GAME_LIMITS, gameSize, type LimitName } from "./limits.ts";
import { RULES } from "./rules/index.ts";
import { parseScript } from "./source.ts";
import type { Rule, SeveritySetting } from "./types.ts";

export const INIT_REASON = "over the game's limits when ic10-lint init ran; trim it, then lower or remove this";

export interface InitOptions {
	/** The scripts' folder, relative to the config's folder. Default `ic10`. */
	dir?: string;
	/** Where to write the config. Default `ic10-lint.json` in `root`. */
	file?: string;
	/** Replace a config that's already there. */
	force?: boolean;
}

/** The schema, for when the package isn't installed under the config's folder. */
export const SCHEMA_URL = "https://unpkg.com/@tasermonkey/ic10-lint/schema.json";

/**
 * The `$schema` for a config in `base`: the installed package's schema.json, relative (so it
 * matches the version and works offline), else the published one.
 */
export function schemaFor(base: string): string {
	for (let dir = resolve(base); ; dir = dirname(dir)) {
		const schema = join(dir, "node_modules", "@tasermonkey", "ic10-lint", "schema.json");
		if (existsSync(schema)) {
			const path = relative(base, schema).replaceAll("\\", "/");
			return path.startsWith(".") ? path : `./${path}`;
		}
		if (dirname(dir) === dir) return SCHEMA_URL;
	}
}

export interface RecommendedConfig {
	$schema: string;
	dir: string;
	rules: Record<string, SeveritySetting>;
	overrides: Record<string, { reason: string; limits: Partial<Record<LimitName, number>> }>;
}

/**
 * A script's measure for each limit that it's over with an error, as the limit rules measure it.
 * Lines past 128 that are only comments and blank lines are a warning, so they get no override.
 */
function overLimits(source: string): Partial<Record<LimitName, number>> {
	const { lines } = parseScript(source.replace(/\r\n/g, "\n"));
	const measure: Record<LimitName, number> = {
		lines: lines.slice(GAME_LIMITS.lines).some((line) => line.tokens.length > 0) ? lines.length : 0,
		columns: Math.max(0, ...lines.map((line) => line.code.length)),
		bytes: gameSize(lines),
	};
	return Object.fromEntries((Object.keys(GAME_LIMITS) as LimitName[]).filter((l) => measure[l] > GAME_LIMITS[l]).map((l) => [l, measure[l]]));
}

/** The recommended config for the project in `base`, with overrides for the scripts in `dir` over a limit. */
export function recommendedConfig(base: string, dir = "ic10"): RecommendedConfig {
	const severity = (rule: Rule): SeveritySetting =>
		rule.defaultOff ? "off" : rule.defaultSeverity === "warning" ? "warn" : rule.defaultSeverity;
	const rules = Object.fromEntries(RULES.map((rule) => [rule.id, severity(rule)]));
	const overrides: RecommendedConfig["overrides"] = {};
	const folder = isAbsolute(dir) ? dir : join(base, dir);
	for (const file of existsSync(folder) ? findScripts(folder) : []) {
		const limits = overLimits(readFileSync(file, "utf8"));
		if (Object.keys(limits).length > 0) overrides[projectRelative(base, file)] = { reason: INIT_REASON, limits };
	}
	return { $schema: schemaFor(base), dir, rules, overrides };
}

/** Write the recommended config; returns where, and what it wrote. Refuses to replace one unless `force`. */
export function initConfig(root: string, options: InitOptions = {}): { file: string; config: RecommendedConfig } {
	const file = resolve(root, options.file ?? CONFIG_FILE);
	if (existsSync(file) && !options.force) throw new Error(`${file}: already exists (--force replaces it)`);
	const config = recommendedConfig(dirname(file), options.dir);
	writeFileSync(file, `${JSON.stringify(config, null, "\t")}\n`);
	return { file, config };
}
