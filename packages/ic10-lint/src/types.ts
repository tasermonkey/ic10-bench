import type { LimitOverride } from "./game-limits.ts";
import type { Script } from "./source.ts";

export type Severity = "error" | "warning" | "info";

/** A severity as the config writes it: "warn" is short for "warning"; "off" turns the rule off. */
export type SeveritySetting = Severity | "warn" | "off";

export interface Finding {
	rule: string;
	severity: Severity;
	/** 0-based, as the game's `LineNumber` and the harness count. */
	line: number;
	/** 0-based. */
	column: number;
	message: string;
	/** The line, trimmed. */
	text: string;
}

/** A device's logic types, Read/Write, and its slots' logic types: what the catalogue checks need. */
export interface LintPrefab {
	prefab: string;
	hash: number;
	/** Logic type → Read/Write. */
	logic: Record<string, "r" | "w" | "rw">;
	slots: { index: number; logic: string[] }[];
}

/** The device catalogue, as data. `@tasermonkey/ic10-bench`'s `loadCatalog()` returns one, mods included. */
export interface BatchOpCatalog {
	prefabs: Record<string, LintPrefab>;
}

/** What a rule's check gets. */
export interface RuleContext {
	script: Script;
	/** The device catalogue, if one was given. Rules with `needsCatalog` only run with one. */
	catalog?: BatchOpCatalog;
	/** The project's override for this script's limits, if it has one. */
	override?: LimitOverride;
	/** A finding at the rule's default severity, unless `severity` is given. */
	report(finding: { line: number; column?: number; message: string; severity?: Severity }): void;
}

export interface Rule {
	id: string;
	/** The severity of its findings, unless a finding gives its own. */
	defaultSeverity: Severity;
	/** Rules that are off unless the config turns them on. */
	defaultOff?: boolean;
	/** Rules that check against the device catalogue; without one, they report that they were skipped. */
	needsCatalog?: boolean;
	/** One line on what it checks, for REFERENCE.md and `--help`. */
	description: string;
	check(context: RuleContext): void | Promise<void>;
}
