import { describe, expect, it } from "vitest";
import { findings } from "./helpers.ts";

const check = (source: string) => findings("validate", source);

describe("validate", () => {
	it("passes a script that loads, devices or not", async () => {
		expect(await check("alias Sensor d0\nstart:\nl r0 Sensor Temperature\nyield\nj start")).toEqual([]);
	});

	it("doesn't count an endless loop against the jump limit", async () => {
		expect(await check("loop:\nadd r0 r0 1\nj loop")).toEqual([]);
	});

	it("reports a wrong argument count, an unknown instruction and an unknown label", async () => {
		const result = await check("move r0\nfrobnicate r1\nj nowhere");
		expect(result.map(([line, severity]) => [line, severity])).toEqual([
			[0, "error"],
			[1, "error"],
			[2, "error"],
		]);
	});

	it("reports a misspelt alias (aliases are case sensitive)", async () => {
		const result = await check("alias Stage r1\nmove stage 0");
		expect(result).toHaveLength(1);
		expect(result[0]![0]).toBe(1);
	});
});
