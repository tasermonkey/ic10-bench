import { parseLiteral } from "@tasermonkey/ic10-lint";

/** A reference ID as a number (`5256`) or in the game's `$hex` form (`"$1488"`), as copied from the tablet. */
export type ReferenceId = number | string;

/** Parse a reference ID given as a number, a decimal string or the game's `$hex` form. */
export function parseId(id: ReferenceId): number {
	if (typeof id === "number") {
		if (Number.isInteger(id) && id >= 0) return id;
	} else {
		const text = id.trim();
		// Read as the emulator reads a literal, but only the forms an ID takes.
		if (/^(\$[0-9a-f]+|\d+)$/i.test(text)) return parseLiteral(text)!;
	}
	throw new Error(`invalid reference ID ${JSON.stringify(id)}: use a whole number or the game's $hex form`);
}

/** Format a reference ID the way the game shows it, e.g. `$1488`. */
export function formatId(id: number): string {
	return `$${id.toString(16).toUpperCase()}`;
}
