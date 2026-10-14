import { describe, expect, it } from "vitest";
import { findings } from "./helpers.ts";

const check = (source: string) => findings("register-flow", source, { rules: { "register-flow": "info" } });

describe("register-flow", () => {
	it("is off unless turned on", async () => {
		expect(await findings("register-flow", "add r0 r1 1")).toEqual([]);
	});

	it("reports a register read before anything writes it, and one written and never read", async () => {
		expect(await check("add r0 r1 1\nmove r2 5")).toEqual([
			[0, "info", "r0 is written but never read"],
			[0, "info", "r1 is read before anything writes it, so it's 0 (or whatever it held before a restart)"],
			[1, "info", "r2 is written but never read"],
		]);
	});

	it("follows aliases, and counts devices' and stores' arguments as reads", async () => {
		expect(await check("alias Level r3\nmove Level 2\ns d0 Setting Level\npush r3")).toEqual([]);
		expect(await check("alias Level r3\ns d0 Setting Level")).toEqual([
			[1, "info", "Level (r3) is read before anything writes it, so it's 0 (or whatever it held before a restart)"],
		]);
	});

	it("takes the severity the config gives it", async () => {
		expect((await findings("register-flow", "move r0 r1", { rules: { "register-flow": "warn" } })).map(([, s]) => s)).toEqual([
			"warning",
			"warning",
		]);
	});
});
