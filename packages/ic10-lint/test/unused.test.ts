import { describe, expect, it } from "vitest";
import { findings } from "./helpers.ts";

const check = (source: string) => findings("unused", source);

describe("unused", () => {
	it("warns about an alias, define or label nothing uses", async () => {
		expect(await check("alias Sensor d0\ndefine MAX 10\nidle:\nmove r0 1")).toEqual([
			[0, "warning", "alias Sensor is never used"],
			[1, "warning", "define MAX is never used"],
			[2, "warning", "label idle is never used"],
		]);
	});

	it("counts any use: in an instruction, another define, a device port, or a jump", async () => {
		expect(
			await check(`alias Sensor d0
alias Pump d1
define LOW 10
define HIGH LOW
start:
l r0 Sensor Temperature
s Pump:0 On 1
blt r0 HIGH start`),
		).toEqual([]);
	});

	it("doesn't count a name that's only inside a HASH() or a comment", async () => {
		expect(await check('define Vent 1\nsbn 0 HASH("Vent") On 1 # Vent')).toEqual([[0, "warning", "define Vent is never used"]]);
	});

	it("reports a name declared twice once", async () => {
		expect(await check("alias x r1\nalias x r2")).toEqual([[0, "warning", "alias x is never used"]]);
	});
});
