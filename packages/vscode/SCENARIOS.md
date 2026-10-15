# Scenarios: exploring without a test

Sometimes you just want to watch a script run in a setup. A **scenario** is a world to run in the
debugger, with no test or expectations. For debugging a test, see the [README](README.md).

## A world module

A file named `x.world.ts` whose default export builds and returns a world:

```ts
// greenhouse.world.ts
import { sim } from "@tasermonkey/ic10-bench";

export default async () => {
	const world = await sim({ root: import.meta.dirname })
		.device("sensor", "StructureGasSensor", { Temperature: 290 })
		.housing("ic", { file: "greenhouse.ic10", pins: { d0: "sensor" } })
		.build();
	world.every({ ticks: 60 }, (w) => w.device("sensor").add("Temperature", -40), { label: "nightfall" });
	return world;
};
```

Open it, or the `greenhouse.ic10` beside it, and click **Debug IC10 Scenario** in the editor title
(or press F5).

## An env JSON

An emulator env JSON works too, the format the
[Stationeers-ic/ic10](https://github.com/Stationeers-ic/ic10) emulator loads. Here's the same
greenhouse as `greenhouse.env.json`, without the nightfall (env JSON has no scripted events):

```json
{
	"version": 1,
	"chips": [{ "id": 1, "code": "yield" }],
	"networks": [{ "id": "base", "type": "data" }],
	"devices": [
		{
			"id": 256,
			"PrefabName": "StructureCircuitHousing",
			"name": "ic",
			"chip": 1,
			"ports": [{ "port": "default", "network": "base" }],
			"pins": [{ "pin": "d0", "device": 512 }]
		},
		{
			"id": 512,
			"PrefabName": "StructureGasSensor",
			"name": "sensor",
			"ports": [{ "port": "default", "network": "base" }],
			"props": [{ "name": "Temperature", "value": 290 }]
		}
	]
}
```

| Field | What it is |
|---|---|
| `chips` | The IC chips, each with an `id` and its `code`. |
| `networks` | The data networks, by `id`. |
| `devices` | Everything else, housings included. `id` is the reference ID, `name` the in-game name. |
| `chip` | On a housing: the chip it runs. |
| `pins` | On a housing: which device, by ID, is on each of `d0` to `d5`. |
| `ports` | Puts a device on a network. |
| `props` | A device's starting logic values. |

When you debug, the chip runs `greenhouse.ic10` instead of the `code` here. Open `greenhouse.ic10`
with `greenhouse.env.json` beside it and press F5, or use a launch configuration with
`"program": "greenhouse.ic10"` (see [Launch configurations](REFERENCE.md#launch-configurations)).

[`examples/scenario.env.json`](examples/scenario.env.json) is a slightly bigger one, with a light.

## Running one

A scenario runs as fast as it can, so **set a breakpoint first** or it may just run to the end. It
stops on its own once every chip has stopped and no events are left.
