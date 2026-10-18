import { parseScript } from "@tasermonkey/ic10-lint";

/**
 * A script as the game keeps it: each line without trailing whitespace, tabs as spaces, no
 * characters outside ASCII, no trailing blank lines, LF line endings. Two texts that are the same
 * this way are the same script to the game, so a chip the game wrote back after loading a file
 * doesn't count as an edit.
 */
export function gameText(source: string): string {
	return parseScript(source)
		.lines.map((line) => line.text)
		.join("\n");
}
