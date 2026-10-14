import { describe, expect, it } from "vitest";
import { code, findings } from "./helpers.ts";

const check = (source: string, override?: { lines: number }) =>
	findings("max-lines", source, override && { override: { reason: "big", limits: override } });

describe("max-lines", () => {
	it("allows exactly 128 lines", async () => {
		expect(await check(code(128))).toEqual([]);
	});

	it("reports the 129th line of code as an error, saying how many are lost", async () => {
		expect(await check(code(130))).toEqual([
			[128, "error", "130 lines; the game keeps 128, so lines 129 to 130 are lost (2 lines of code)"],
		]);
	});

	it("counts comment and blank lines, but only warns when only they are lost", async () => {
		expect(await check(`${code(127)}\n# a comment\n\n# another`)).toEqual([
			[128, "warning", "130 lines; the game keeps 128, so lines 129 to 130 are lost (only comments and blank lines)"],
		]);
	});

	it("points at the first lost line of code, past any lost comments", async () => {
		expect((await check(`${code(128)}\n# note\nmove r1 2`)).map(([line]) => line)).toEqual([129]);
	});

	it("drops trailing blank lines and whitespace first, as the game does", async () => {
		expect(await check(`${code(128)}\n\n   \n\t\n`)).toEqual([]);
	});

	it("counts CRLF line endings once", async () => {
		expect(await check(code(128).replaceAll("\n", "\r\n"))).toEqual([]);
		expect(await check(code(129).replaceAll("\n", "\r\n"))).toHaveLength(1);
	});

	describe("with an override", () => {
		it("reports the script as info while it stays within the override", async () => {
			expect(await check(code(140), { lines: 140 })).toEqual([
				[128, "info", expect.stringMatching(/^140 lines; .* \(allowed by an override: big\)$/)],
			]);
		});

		it("is an error once the script grows past the override", async () => {
			expect(await check(code(141), { lines: 140 })).toEqual([
				[128, "error", "141 lines; the game keeps 128, so lines 129 to 141 are lost (13 lines of code), more than the override's 140"],
			]);
		});

		it("asks for the override to be lowered when the script shrinks", async () => {
			expect((await check(code(135), { lines: 140 })).map(([, s, m]) => [s, m])).toEqual([
				["warning", "now 135 lines; lower the override from 140 to 135"],
				["info", expect.stringMatching(/^135 lines/)],
			]);
		});

		it("is an error once the override isn't needed", async () => {
			expect(await check(code(128), { lines: 140 })).toEqual([
				[0, "error", "the override allowing 140 lines is no longer needed (now 128); remove it"],
			]);
		});
	});
});
