import type { LimitOverride } from "./limits.ts";
import { RULES } from "./rules/index.ts";
import { parseScript } from "./source.ts";
import type { BatchOpCatalog, Finding, Severity, SeveritySetting } from "./types.ts";

export interface LintOptions {
	/** The device catalogue, for the rules that check against it. Without one they're skipped, with an info finding. */
	catalog?: BatchOpCatalog;
	/** Severity by rule id, overriding the rule's own; "off" turns it off. Ids no rule has are ignored. */
	rules?: Record<string, SeveritySetting>;
	/** This script's allowance over the game's limits (from the config's `overrides`). */
	override?: LimitOverride;
}

const RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

/** "warn" → "warning"; anything else as it is. */
export function normalizeSeverity(setting: SeveritySetting): Severity | "off" {
	return setting === "warn" ? "warning" : setting;
}

/** Whether a finding's severity is at least `threshold`. */
export function atLeast(severity: Severity, threshold: Severity): boolean {
	return RANK[severity] >= RANK[threshold];
}

/**
 * A finding's severity under the config. The configured severity takes the place of the rule's
 * default. A finding the rule made milder than its default (a cut comment, an override's info)
 * stays that mild, or milder if the config says so. So a config that names a rule's default
 * changes nothing.
 */
function severityOf(own: Severity, ruleDefault: Severity, configured: Severity | undefined): Severity {
	if (configured === undefined) return own;
	if (RANK[own] < RANK[ruleDefault]) return RANK[own] < RANK[configured] ? own : configured;
	return configured;
}

/** Check one script's source. Findings are sorted by line, then column. */
export async function lint(source: string, options: LintOptions = {}): Promise<Finding[]> {
	const script = parseScript(source.replace(/\r\n/g, "\n"));
	const findings: Finding[] = [];
	for (const rule of RULES) {
		const setting = options.rules?.[rule.id];
		const configured = setting === undefined ? undefined : normalizeSeverity(setting);
		if (configured === "off" || (configured === undefined && rule.defaultOff)) continue;
		if (rule.needsCatalog && !options.catalog) {
			findings.push({
				rule: rule.id,
				severity: "info",
				line: 0,
				column: 0,
				message: "skipped: no device catalogue given",
				text: "",
			});
			continue;
		}
		await rule.check({
			script,
			catalog: options.catalog,
			override: options.override,
			report({ line, column = 0, message, severity }) {
				findings.push({
					rule: rule.id,
					severity: severityOf(severity ?? rule.defaultSeverity, rule.defaultSeverity, configured),
					line,
					column,
					message,
					text: script.lines[line]?.text.trim() ?? "",
				});
			},
		});
	}
	return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}
