import { sim } from "@tasermonkey/ic10-bench";
import { describe, expect, it } from "vitest";

// TODO: a skeleton test from `ic10-bench init`. Add the devices the script uses, wire them to its
// pins, add real checks, then remove `.skip`. A walkthrough of a first test:
// https://github.com/tasermonkey/ic10-bench/blob/main/packages/ic10-bench/TUTORIAL.md
describe("Counter [450]", () => {
	it.skip("runs without an error", async () => {
		const world = await sim({ root: import.meta.dirname })
			// .device("sensor", "StructureGasSensor")   one for each device the script uses
			.housing("ic", { file: "../Counter [450].ic10", pins: {} }) // e.g. pins: { d0: "sensor" }
			.build();

		await world.runTicks(20);

		expect(world.chip("ic")).toHaveNoErrors();
	});
});
