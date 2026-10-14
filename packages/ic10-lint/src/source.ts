/**
 * A script as the game reads it when you paste it into the chip editor (InputSourceCode.Paste): the
 * text and each line lose trailing whitespace, tabs become spaces, and characters outside ASCII are
 * dropped. The rules all look at the script through this, so they agree with the game.
 */

export interface SourceLine {
	/** 0-based. */
	index: number;
	/** The line as the game keeps it, before it cuts the line at 90 characters. */
	text: string;
	/** The code before any `#` comment, without trailing spaces. */
	code: string;
	/** Where the comment starts, or -1. */
	commentAt: number;
	/** The code's tokens: `HASH("…")` and `STR("…")` whole (they may hold spaces or `#`), else runs of non-blanks. */
	tokens: string[];
	/** Each token's column in `text`. */
	columns: number[];
	/** `name:` on a line of its own. */
	label?: string;
}

export interface Declaration {
	name: string;
	value: string;
	line: number;
}

export interface Script {
	/** Trailing blank lines are dropped, as the game does. */
	lines: SourceLine[];
	/** Every `define`, `alias` and label, in order. A name can appear more than once. */
	defines: Declaration[];
	aliases: Declaration[];
	labels: Declaration[];
}

const TOKEN = /(?:HASH|STR)\("[^"]*"\)|[^\s]+/g;
const QUOTED = /(?:HASH|STR)\("[^"]*"\)/g;

/** Where a line's comment starts, skipping `#` inside `HASH("…")` / `STR("…")`, or -1. */
function commentStart(text: string): number {
	const blanked = text.replace(QUOTED, (m) => " ".repeat(m.length));
	return blanked.indexOf("#");
}

/** The game's cleanup of one line (AsciiString.ParseLine, without the cut at 90). */
export function gameLine(line: string): string {
	return line.trimEnd().replace(/\t/g, " ").replace(/[^\x00-\x7F]/g, "");
}

export function parseScript(source: string): Script {
	const raw = source.trimEnd().split("\n");
	const lines = raw.map((line, index): SourceLine => {
		const text = gameLine(line);
		const commentAt = commentStart(text);
		const code = (commentAt >= 0 ? text.slice(0, commentAt) : text).trimEnd();
		const tokens: string[] = [];
		const columns: number[] = [];
		for (const match of code.matchAll(TOKEN)) {
			tokens.push(match[0]);
			columns.push(match.index);
		}
		const label = tokens.length === 1 && /^[A-Za-z_]\w*:$/.test(tokens[0]!) ? tokens[0]!.slice(0, -1) : undefined;
		return { index, text, code, commentAt, tokens, columns, label };
	});

	const defines: Declaration[] = [];
	const aliases: Declaration[] = [];
	const labels: Declaration[] = [];
	for (const line of lines) {
		const [op, name, value] = line.tokens;
		if (line.label) labels.push({ name: line.label, value: String(line.index), line: line.index });
		else if (op === "define" && name && value !== undefined) defines.push({ name, value, line: line.index });
		else if (op === "alias" && name && value !== undefined) aliases.push({ name, value, line: line.index });
	}
	return { lines, defines, aliases, labels };
}

/** The opcode and arguments of an instruction line, or undefined for a blank, comment or label line. */
export function instruction(line: SourceLine): { op: string; args: string[] } | undefined {
	if (line.label || line.tokens.length === 0) return undefined;
	const [op, ...args] = line.tokens;
	return { op: op!, args };
}
