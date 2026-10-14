import { allowance, GAME_LIMITS, overLimit } from "../limits.ts";
import type { Rule } from "../types.ts";

/**
 * The chip editor has 128 lines; pasting keeps the first 128. Lost instructions or labels are an
 * error, lost comments and blank lines a warning. Comment and blank lines count, as they're
 * addresses too.
 */
export const maxLines: Rule = {
	id: "max-lines",
	defaultSeverity: "error",
	description: "No more than the game's 128 lines (comments and blank lines count)",
	check(context) {
		const { lines } = context.script;
		const count = lines.length;
		const allowed = allowance(context, "lines", count);
		if (count <= GAME_LIMITS.lines) return;

		const lost = lines.slice(GAME_LIMITS.lines);
		const code = lost.filter((line) => line.tokens.length > 0);
		const first = code[0] ?? lost[0]!;
		const what = code.length > 0 ? `${code.length} lines of code` : "only comments and blank lines";
		overLimit(context, allowed, count, {
			line: first.index,
			severity: code.length > 0 ? "error" : "warning",
			message: `${count} lines; the game keeps ${GAME_LIMITS.lines}, so lines ${GAME_LIMITS.lines + 1} to ${count} are lost (${what})`,
		});
	},
};
