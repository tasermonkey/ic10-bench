import { describe, expect, it } from "vitest";
import { gameSize } from "../src/limits.ts";
import { parseScript } from "../src/source.ts";
import { findings } from "./helpers.ts";

const check = (source: string, override?: { bytes: number }) =>
	findings("max-bytes", source, override && { override: { reason: "big", limits: override } });

const size = (source: string) => gameSize(parseScript(source).lines);

/** Lines of 30 characters (`# xxx…`), `n` of them: 30 each plus 2 per line break. */
const lines30 = (n: number) => Array.from({ length: n }, () => `#${"x".repeat(29)}`).join("\n");

describe("max-bytes", () => {
	it("counts each line break as 2, as the game's CRLF", () => {
		expect(size("move r0 1")).toBe(9);
		expect(size("move r0 1\nmove r0 2")).toBe(20);
		expect(size("move r0 1\r\nmove r0 2")).toBe(20);
	});

	it("drops trailing whitespace and blank lines, and counts blank lines in between", () => {
		expect(size("move r0 1   \n\n\n")).toBe(9);
		expect(size("move r0 1\n\nmove r0 2")).toBe(22);
		expect(size("move r0 1\t\t")).toBe(9);
	});

	it("counts a line at most 90, as the game cuts it there", () => {
		expect(size(`#${"x".repeat(199)}`)).toBe(90);
	});

	it("allows exactly 4096", async () => {
		// 128 lines of 30 = 3840, plus 127 breaks of 2 = 4094; two more characters make 4096.
		const source = `${lines30(127)}\n#${"x".repeat(31)}`;
		expect(size(source)).toBe(4096);
		expect(await check(source)).toEqual([]);
	});

	it("reports 4097 at the character that passes the limit", async () => {
		const source = `${lines30(127)}\n#${"x".repeat(32)}`;
		expect(size(source)).toBe(4097);
		const result = await lintAt(source);
		expect(result).toEqual([[127, 32, "error", "4097 characters as the game counts them; it takes 4096"]]);
	});

	describe("with an override", () => {
		it("is info within it, an error past it, and an error once it isn't needed", async () => {
			const big = `${lines30(127)}\n#${"x".repeat(60)}`; // 4125
			expect((await check(big, { bytes: 4125 })).map(([, s]) => s)).toEqual(["info"]);
			expect((await check(big, { bytes: 4100 })).map(([, s]) => s)).toEqual(["error"]);
			expect(await check("move r0 1", { bytes: 4100 })).toEqual([
				[0, "error", "the override allowing 4100 characters is no longer needed (now 9); remove it"],
			]);
		});
	});
});

async function lintAt(source: string) {
	const { lint } = await import("../src/lint.ts");
	return (await lint(source)).filter((f) => f.rule === "max-bytes").map((f) => [f.line, f.column, f.severity, f.message]);
}
