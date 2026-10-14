import { allowance, byteOffsets, GAME_LIMITS, overLimit } from "../limits.ts";
import type { Rule } from "../types.ts";

/**
 * The game won't take a script over 4096 characters, counted its way: trailing whitespace and
 * blank lines dropped, each line break as 2 (CRLF). The finding points where the count passes 4096.
 */
export const maxBytes: Rule = {
	id: "max-bytes",
	defaultSeverity: "error",
	description: "No more than the game's 4096 characters, counted as the game counts them",
	check(context) {
		const { lines } = context.script;
		const { starts, total } = byteOffsets(lines);
		const allowed = allowance(context, "bytes", total);
		if (total <= GAME_LIMITS.bytes) return;

		// The line holding character 4097, or the line break after it.
		let line = starts.findIndex((start, i) => (starts[i + 1] ?? total) > GAME_LIMITS.bytes);
		if (line < 0) line = lines.length - 1;
		const column = Math.min(GAME_LIMITS.bytes - starts[line]!, lines[line]!.text.length);
		overLimit(context, allowed, total, {
			line,
			column,
			message: `${total} characters as the game counts them; it takes ${GAME_LIMITS.bytes}`,
		});
	},
};
