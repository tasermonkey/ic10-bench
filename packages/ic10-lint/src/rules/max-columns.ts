import { allowance, GAME_LIMITS, overLimit } from "../limits.ts";
import type { Rule } from "../types.ts";

/**
 * The game cuts each line at 90 characters when you paste. Cutting code is an error (the line
 * changes meaning or stops compiling); cutting only a comment is a warning.
 */
export const maxColumns: Rule = {
	id: "max-columns",
	defaultSeverity: "error",
	description: "No line past the game's 90 characters (only a comment past it is a warning)",
	check(context) {
		const { lines } = context.script;
		const limit = GAME_LIMITS.columns;
		const longestCode = Math.max(0, ...lines.map((line) => line.code.length));
		const allowed = allowance(context, "columns", longestCode);

		for (const line of lines) {
			if (line.text.length <= limit) continue;
			if (line.code.length > limit) {
				overLimit(context, allowed, line.code.length, {
					line: line.index,
					column: limit,
					message: `${line.code.length} characters of code; the game cuts the line at ${limit}`,
				});
			} else {
				context.report({
					line: line.index,
					column: limit,
					severity: "warning",
					message: `${line.text.length} characters; the game cuts the line at ${limit}, losing the end of the comment`,
				});
			}
		}
	},
};
