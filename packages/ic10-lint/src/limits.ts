/**
 * The chip editor's limits, from the game's InputSourceCode (as FlorpyDorp's ic10lsp also cites):
 * 128 lines, 90 characters a line, 4096 characters in all. Pasting a longer script keeps the first
 * 128 lines and the first 90 characters of each; a script over 4096 can't be submitted.
 */
import type { SourceLine } from "./source.ts";
import type { RuleContext, Severity } from "./types.ts";

export const GAME_LIMITS = { lines: 128, columns: 90, bytes: 4096 } as const;

export type LimitName = keyof typeof GAME_LIMITS;

/** A project's allowance for one script that's over a limit: it may stay that size, but not grow. */
export interface LimitOverride {
	reason: string;
	limits?: Partial<Record<LimitName, number>>;
}

/**
 * Where each line starts in the game's count of the script's size, and the total
 * (InputSourceCode.UpdateFileSize): each line's length, cut at 90, plus 2 for each line break
 * (CRLF) up to the last line that isn't blank. Unlike the game, it counts past line 128, so a
 * script over both limits shows its whole size.
 */
export function byteOffsets(lines: readonly SourceLine[]): { starts: number[]; total: number } {
	let last = lines.length - 1;
	while (last > 0 && lines[last]!.text.length === 0) last--;
	const starts: number[] = [];
	let total = 0;
	lines.forEach((line, i) => {
		starts.push(total);
		total += Math.min(line.text.length, GAME_LIMITS.columns);
		if (i < last) total += 2;
	});
	return { starts, total };
}

/** The script's size as the game counts it. */
export function gameSize(lines: readonly SourceLine[]): number {
	return byteOffsets(lines).total;
}

const UNITS: Record<LimitName, string> = { lines: "lines", columns: "characters a line", bytes: "characters" };

/**
 * The project's allowance for a limit, given the script's measure (its line count, longest line of
 * code, or size). Reports an override that's no longer needed (an error) or larger than needed (a
 * warning), so overrides ratchet down as scripts shrink.
 */
export function allowance(context: RuleContext, limit: LimitName, measure: number): number | undefined {
	const allowed = context.override?.limits?.[limit];
	if (allowed === undefined) return undefined;
	if (measure <= GAME_LIMITS[limit]) {
		context.report({
			line: 0,
			severity: "error",
			message: `the override allowing ${allowed} ${UNITS[limit]} is no longer needed (now ${measure}); remove it`,
		});
		return undefined;
	}
	if (measure < allowed) {
		context.report({
			line: 0,
			severity: "warning",
			message: `now ${measure} ${UNITS[limit]}; lower the override from ${allowed} to ${measure}`,
		});
	}
	return allowed;
}

/**
 * A finding for something over a game limit: as given without an override, info within the
 * override (with its reason), and an error past it.
 */
export function overLimit(
	context: RuleContext,
	allowed: number | undefined,
	measure: number,
	finding: { line: number; column?: number; message: string; severity?: Severity },
): void {
	if (allowed === undefined) context.report(finding);
	else if (measure <= allowed) {
		context.report({ ...finding, severity: "info", message: `${finding.message} (allowed by an override: ${context.override!.reason})` });
	} else context.report({ ...finding, severity: "error", message: `${finding.message}, more than the override's ${allowed}` });
}
