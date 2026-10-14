import { describe, expect, it } from "vitest";
import { findings } from "./helpers.ts";

const check = (source: string, override?: { columns: number }) =>
	findings("max-columns", source, override && { override: { reason: "long", limits: override } });

/** `move r0 1` padded with a comment to exactly `width` characters. */
const commented = (width: number) => `move r0 1 #${"x".repeat(width - 11)}`;
/** A line of code exactly `width` characters long. */
const longCode = (width: number) => `sbn HASH("StructureWallLight") HASH("${"N".repeat(width - 44)}") On 1`;

describe("max-columns", () => {
	it("allows a line of exactly 90 characters", async () => {
		expect(longCode(90)).toHaveLength(90);
		expect(await check(longCode(90))).toEqual([]);
		expect(await check(commented(90))).toEqual([]);
	});

	it("reports code past column 90 as an error, at column 90", async () => {
		const source = `move r0 1\n${longCode(91)}`;
		expect(await check(source)).toEqual([[1, "error", "91 characters of code; the game cuts the line at 90"]]);
		const all = await findings("max-columns", source);
		expect(all).toHaveLength(1);
	});

	it("warns when only a comment goes past column 90", async () => {
		expect(await check(commented(95))).toEqual([
			[0, "warning", "95 characters; the game cuts the line at 90, losing the end of the comment"],
		]);
	});

	it("keeps a cut comment a warning when the config names the default, and follows a milder setting", async () => {
		const source = `${commented(95)}\n${longCode(91)}`;
		const severities = async (setting: "error" | "warn" | "info") =>
			(await findings("max-columns", source, { rules: { "max-columns": setting } })).map(([, severity]) => severity);
		expect(await severities("error")).toEqual(["warning", "error"]);
		expect(await severities("warn")).toEqual(["warning", "warning"]);
		expect(await severities("info")).toEqual(["info", "info"]);
	});

	it("ignores trailing whitespace, and counts a tab as one space", async () => {
		expect(await check(`${longCode(90)}      \t`)).toEqual([]);
		expect(await check(`\t${longCode(89)}`)).toEqual([]);
	});

	it("doesn't count characters the game drops (outside ASCII)", async () => {
		expect(await check(`${commented(89)}°`)).toEqual([]);
	});

	it("reads CRLF line endings as the game does", async () => {
		expect(await check(`${longCode(90)}\r\nmove r0 1`)).toEqual([]);
	});

	describe("with an override", () => {
		it("reports code lines within the override as info, and past it as errors", async () => {
			const result = await check(`${longCode(92)}\n${longCode(95)}`, { columns: 92 });
			expect(result.map(([line, severity]) => [line, severity])).toEqual([
				[0, "info"],
				[1, "error"],
			]);
		});

		it("still warns about long comments", async () => {
			expect((await check(`${longCode(92)}\n${commented(100)}`, { columns: 92 })).map(([l, s]) => [l, s])).toEqual([
				[0, "info"],
				[1, "warning"],
			]);
		});

		it("is an error once no line of code needs it, even with long comments left", async () => {
			expect(await check(commented(100), { columns: 92 })).toEqual([
				[0, "error", "the override allowing 92 characters a line is no longer needed (now 9); remove it"],
				[0, "warning", "100 characters; the game cuts the line at 90, losing the end of the comment"],
			]);
		});
	});
});
