/**
 * The one number parser: a literal as the emulator reads it (`5`, `-1.5`, `2e3`, `$1488`, `%101`,
 * `HASH("…")`, a constant such as `nan` or `Color.Green`), built from the fork's own parsers so the
 * linter, the harness and the debugger all agree with the emulator.
 */
import { getConst, parseBin, parseHash, parseHex, parseSimpleNumber } from "@tasermonkey/ic10";

type ConstArgument = Parameters<typeof getConst>[0];

const PARSERS: ((text: string) => number | false)[] = [
	parseSimpleNumber,
	parseHex,
	parseBin,
	parseHash,
	(text) => getConst({ text } as ConstArgument),
];

/** The number a literal stands for, or undefined if it isn't one (a register, alias, define or label). */
export function parseLiteral(text: string): number | undefined {
	for (const parse of PARSERS) {
		const value = parse(text);
		if (value !== false) return value;
	}
	return undefined;
}
