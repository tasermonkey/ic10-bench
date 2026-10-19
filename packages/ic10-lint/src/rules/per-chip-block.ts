import type { Rule } from "../types.ts";

/**
 * A script's per-chip blocks (`per-chip.ts`) as ic10-link needs them: each marker with its pair, on
 * a line of code, no block inside another, and each block its per-script file declares in the
 * script. Without that, ic10-link can't tell which lines are each chip's.
 */
export const perChipBlock: Rule = {
	id: "per-chip-block",
	defaultSeverity: "error",
	description: "A per-chip block (# link-per-chip { … }) that ic10-link can't find: a marker without its pair, nested, or a bad <script>.json",
	check(context) {
		for (const { line, message } of context.perChip.problems) {
			context.report({ line, column: Math.max(context.script.lines[line]?.commentAt ?? 0, 0), message });
		}
	},
};
