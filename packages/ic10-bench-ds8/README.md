# @tasermonkey/ic10-bench-ds8

The [DS-8 Server Rack](https://steamcommunity.com/sharedfiles/filedetails/?id=3819662919) mod for
[IC10 Bench](../ic10-bench#readme): test Stationeers IC10 scripts that run in the rack's twelve
processor sockets. The rack's drives, status registers and patch field work as they do in the mod.

```ts
import { sim } from "@tasermonkey/ic10-bench";
import { serverRack } from "@tasermonkey/ic10-bench-ds8";

const world = await sim()
	.device("sensor", "StructureGasSensor", { Pressure: 80 })
	.device("vent", "StructureActiveVent")
	.add("rack", serverRack, {
		pins: { d0: "sensor", d1: "vent" },
		// index = processor − 1; holes are empty sockets
		chips: [{ key: "airlock", file: "ic10/airlock.ic10" }, , , , { key: "climate", file: "ic10/climate.ic10" }],
	})
	.build();

await world.runTicks(10);
expect(world.chip("airlock").db.key).toBe("rack"); // db is the rack
expect(serverRack.handle(world, "rack").memory(4116)).toBe(2); // processor 1 is running
```

## Getting started

1. In an IC10 Bench project, `npm install --save-dev @tasermonkey/ic10-bench-ds8`.
2. Put the rack in your `ic10-mods/`: export the game's devices with the mod installed, then run
   `npx ic10-bench import-mods` (see IC10 Bench's
   [Using modded devices](../ic10-bench/README.md#using-modded-devices)).
3. Build worlds with `.add(key, serverRack, options)`, as above.

## The idle test

A script for the rack says so beside it, in `<script>.ic10.json`: `{ "host": "StructureServerRack" }`.
Pass the kind to the script checks, and its idle test runs it in a rack's first socket:

```ts
import { describeScriptChecks } from "@tasermonkey/ic10-bench/checks";
import { serverRack } from "@tasermonkey/ic10-bench-ds8";

describeScriptChecks({ extensions: [serverRack] });
```

## What it doesn't do

The rack's own automation (rules, scenes, its ready-made programs, print jobs), its screens and
keys, heat, the air filter and the UPS aren't simulated. Their status registers hold what a test
sets. See the [reference](REFERENCE.md) for the options, the handle, the ports and the memory map.
