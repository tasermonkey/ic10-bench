import { HashString } from "@tasermonkey/ic10";
import { describe, expect, it } from "vitest";
import { parseLiteral } from "../src/numbers.ts";

describe("parseLiteral", () => {
	it("reads the literals the emulator reads", () => {
		expect(parseLiteral("5")).toBe(5);
		expect(parseLiteral("-1.5")).toBe(-1.5);
		expect(parseLiteral("2e3")).toBe(2000);
		expect(parseLiteral("$1488")).toBe(0x1488);
		expect(parseLiteral("%101")).toBe(5);
		expect(parseLiteral("0")).toBe(0);
		expect(parseLiteral('HASH("StructureActiveVent")')).toBe(new HashString("StructureActiveVent").hash);
		expect(parseLiteral("Color.Green")).toBe(2);
		expect(parseLiteral("nan")).toBeNaN();
		expect(parseLiteral("pinf")).toBe(Infinity);
	});

	it("rejects what the game rejects, and names", () => {
		for (const text of ["$ZZ", "%2", "12abc", "r0", "Sensor", "loop"]) expect(parseLiteral(text), text).toBeUndefined();
	});
});
