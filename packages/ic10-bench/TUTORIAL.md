# Your first test

A walk through one script and its test, with every line of the test explained. Set up the project
first with `npx @tasermonkey/ic10-bench init`, as in the README's [Getting started](README.md#getting-started).

## The script

A thermostat, `thermostat.ic10`:

```
alias Sensor d0
alias Heater d1
loop:
l r0 Sensor Temperature
slt r1 r0 293
s Heater On r1
yield
j loop
```

## The test

`thermostat.test.ts`, beside it:

```ts
// sim() builds an emulated world for your script to run in.
import { sim } from "@tasermonkey/ic10-bench";
// Vitest's test functions: describe groups tests, it is one test, expect checks a result.
import { describe, expect, it } from "vitest";

describe("thermostat", () => {
	// Each test is async, because running the world is.
	it("turns the heater on when it's cold, and off when it's warm", async () => {
		// root: script paths below are relative to this test file's folder.
		const world = await sim({ root: import.meta.dirname })
			// A device: the name the test calls it, its prefab, and starting values for its
			// logic properties. Here the sensor reads 280 K (about 7 °C).
			// The last argument is optional. name is the device's in-game name, the one you'd
			// give it with a Labeller. Batch instructions that filter by name, such as
			// lbn r0 HASH("StructureGasSensor") HASH("Room Sensor") Temperature Average,
			// find the device by it.
			.device("sensor", "StructureGasSensor", { Temperature: 280 }, { name: "Room Sensor" })
			// A heater, with every property at its default (On is 0).
			.device("heater", "StructureWallHeater", {}, { name: "Room Heater" })
			// An IC housing running thermostat.ic10, with its d0 and d1 screws set to the
			// devices above, as you'd set them with a screwdriver in game.
			.housing("ic", { file: "thermostat.ic10", pins: { d0: "sensor", d1: "heater" } })
			// Puts it all together. Everything is on one data network unless you say otherwise.
			.build();

		// One game tick (half a second): the chip runs until its yield.
		await world.runTicks(1);
		// The script read 280 K, which is below 293, so it switched the heater on.
		expect(world.device("heater")).toHaveProps({ On: 1 });

		// Change the world between ticks, as the game would: the room has warmed up.
		world.device("sensor").set("Temperature", 300);
		// The chip carries on from after its yield, goes round the loop, and reads 300 K.
		await world.runTicks(1);
		expect(world.device("heater")).toHaveProps({ On: 0 });
	});
});
```

## Run it

Run `npm test`. To step through the script line by line, install the
[VS Code extension](https://github.com/tasermonkey/ic10-bench/tree/main/packages/vscode#readme),
set a breakpoint in `thermostat.ic10`, and click **▶ Debug IC10** above the test.

From here, the [README](README.md) covers the rest: networks, pipes and rooms, scripted events,
device models and the matchers, and [REFERENCE.md](REFERENCE.md) lists every call.
