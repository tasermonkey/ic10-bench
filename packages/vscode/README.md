# IC10 Bench for VS Code

Test your Stationeers IC10 scripts with [Vitest](https://vitest.dev/) tests, and step through them
in the VS Code debugger. Set a breakpoint in a `.ic10` file, start the test, and you can see every
register, the stack and every device, change values, and step a line or a game tick at a time.

The tests use [`@tasermonkey/ic10-bench`](https://github.com/tasermonkey/ic10-bench/tree/main/packages/ic10-bench#readme),
which runs your scripts in an emulator under the game's rules: game ticks, the 128-line automatic
yield, `sleep`, and a chip halting on an error.

## Why I built this

> Every Stationeer has a story about the divide by zero that turned their base into a fireball.

More and more players are using AI to write their IC10 scripts, and AI does much better when it can
quickly test the code it writes. I wanted a testing framework for IC10 that gives it that: the
[`@tasermonkey/ic10-bench`](https://github.com/tasermonkey/ic10-bench/tree/main/packages/ic10-bench#readme)
tests run with `npm test`, with no game needed, so an AI assistant can write a script, test it and
fix it on its own. This extension is for you: when a test fails, you can step through the script
line by line and see exactly what it did.

I built it against my own scripts, and with the emulator and the tests, the AI found bugs in IC10
code I'd been running in game. Some of them explained strange behaviour I'd seen and never tracked
down: a suit controller switching its filtration on and off over and over, and a fabricator
controller that only noticed some of its button presses (it checked one fabricator's buttons each
tick, so it missed presses on the others). With a failing test for each, they were quick to fix.

Testing in game is slow. You build the setup, wait for the right conditions (night, a low battery,
a full tank), and watch. Most cases never get tried, and when something goes wrong you rarely see
why. A test sets up those conditions in a few lines and checks the result in milliseconds. It runs
every time you change the script, so a fix for one thing can't quietly break another, and it says
what the script is supposed to do, for the next person who reads it, or for you in six months.
Writing the test first, so it fails until the script is right, is a good way to fix a bug and
know it's fixed.

My hope is that IC10 Bench makes that cheap enough to be worth doing for IC10: that players, and
the AI tools they use, write tests alongside their scripts, catch bugs before they cause a base to explode, and
share scripts that come with proof they work.

## Usage

You need [Node.js](https://nodejs.org/) 24 or later on your `PATH`.

1. In the folder with your scripts, set up a project and install the test framework:
   ```
   npm init -y
   npm pkg set type=module
   npm install --save-dev @tasermonkey/ic10-bench vitest
   ```
2. Add a `vitest.config.ts`:
   ```ts
   import { defineIc10Config } from "@tasermonkey/ic10-bench/config";

   export default defineIc10Config();
   ```
3. Add the test scripts to your `package.json`:
   ```json
   "scripts": {
     "pretest": "ic10-bench catalog",
     "test": "vitest run"
   }
   ```
   `ic10-bench catalog` reads your Stationeers install for each device's properties and their
   descriptions. It writes `.ic10-bench/` and `ic10-bench-env.d.ts`, which hold the game's text, so
   add both to your `.gitignore`.
4. Write a script and a test for it. A thermostat, `thermostat.ic10`:
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
   and its test, `thermostat.test.ts`, beside it:
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
5. Run `npm test`. To step through the script, see [Debugging a test](#debugging-a-test) below.

The [`@tasermonkey/ic10-bench` README](https://github.com/tasermonkey/ic10-bench/tree/main/packages/ic10-bench#readme)
covers the rest: networks, pipes and rooms, scripted events, device models, and every matcher.

This extension adds breakpoints to `.ic10` files but doesn't syntax highlight them. For that I
suggest [FlorpyDorp IC10 Language Support](https://marketplace.visualstudio.com/items?itemName=FlorpyDorp.florpydorp-ic10-language-support).

## Debugging a test

1. Open your `.ic10` script and click in the margin to set a breakpoint.
2. Open the test that runs it and click **▶ Debug IC10** above the `it(...)` (or above a `describe`
   to run the group).
3. The test stops at your breakpoint. From there:
   - **F10 / F11 / Shift+F11** step over, into (a `jal`) and out of a subroutine;
   - **Variables** shows the chip's registers (with their aliases), stack, devices, pipes and rooms,
     and the game tick. Double-click a register, stack entry or device property to change it;
   - hover over a register or `d0.On` to see its value, or add it to **Watch**;
   - each chip is a thread in **Call Stack**, so you can switch between them.

Other ways to start: **F5** with the test file open, or **IC10 Bench: Debug IC10 in the Test at the
Cursor** from the command palette.

The debugger also stops when a chip halts on an error, showing why. Under **Breakpoints**, tick
**Automatic yields** to also stop when a chip runs out of its 128 lines in a tick.

## Running by game ticks

While stopped, the debug toolbar has three more buttons. Each goes by the chip selected in Call
Stack:

- **Step Tick** runs to the chip's next turn, past its `yield` or `sleep`. Other chips run as usual.
- **Run N Ticks…** runs that many ticks, then stops.
- **Run Until Event…** runs until one of the test's scheduled events (`world.at`, `every`, `when`)
  happens.

## Breakpoints that do more

- **Conditions.** Right-click a breakpoint, **Edit Condition**, and enter something like
  `Counter == 5` or `d0.Temperature > 300`.
- **Logpoints.** Instead of stopping, print a message: `count {Counter}`. It shows in the Debug
  Console.
- **Break on a value changing.** Right-click a value in Variables (a register, a stack entry, a
  device property) or Watch, and choose **Break on Value Change**. The debugger stops right after the
  line that changed it, or names the scripted event if something outside the chip did.

While stopped, each line above the one you're on shows the values it uses at its end (`Stage = 2`,
`Vent.On = 1`). They're the values now, not when the line ran. Turn them off with VS Code's
`debug.inlineValues` setting.

## Exploring without a test

Sometimes you just want to watch a script run in a setup. Write a **scenario**: a file named
`x.world.ts` whose default export builds and returns a world.

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

- `chips` are the IC chips, each with its code. `devices` are everything else, housings included;
  `id` is the reference ID, and `name` is the in-game name.
- A housing runs the chip given by `chip`, and its `pins` set `d0` to `d5` to devices by ID.
- `ports` put a device on a network; `props` are its starting logic values.
- When you debug, the chip runs `greenhouse.ic10` instead of the `code` here. Open
  `greenhouse.ic10` with `greenhouse.env.json` beside it and press F5, or use a launch
  configuration with `"program": "greenhouse.ic10"` (see below).

[`examples/scenario.env.json`](examples/scenario.env.json) is a slightly bigger one, with a light.

A scenario runs as fast as it can, so **set a breakpoint first** or it may just run to the end. It
stops on its own once every chip has stopped and no events are left.

## Debugging the TypeScript too

If you also want to stop in the test's own code (a model, an event, an expectation), turn on the
setting **IC10 Bench: Debug TypeScript**. Breakpoints in `.ts` files then stop as well, in a second
session under the IC10 one in Call Stack. While the TypeScript is stopped, the IC10 side shows as
running. Stopping either session ends both.

## Try it

[`examples/`](examples/) has one small test and script for each feature, with what to try written
at the top of each script.

## Launch configurations

You don't need a `launch.json`, but you can add one to save a setup:

```jsonc
{
	"type": "ic10-bench",
	"request": "launch",
	"name": "Debug a test",
	"test": "${workspaceFolder}/tests/MyBase/airlock.test.ts",
	"line": 27,                  // the it(...) to run; the whole file if left out
	"stopOnEntry": false,
	"debugTypeScript": false
}
```

```jsonc
{
	"type": "ic10-bench",
	"request": "launch",
	"name": "Debug the scenario in the current file",
	"scenario": "${file}",       // a world module, env JSON, or an .ic10 with one beside it
	"program": "x.ic10",         // env JSON only: the script a chip runs
	"chip": "housing"            // env JSON only: which chip runs it, if there's more than one
}
```

Every setting a launch configuration takes:

| Setting | What it does |
|---|---|
| `test` | The test file to debug. |
| `line` | The line of the `it(...)` or `describe(...)` to run. Leave it out to run the whole file. |
| `scenario` | A world module, env JSON or `.ic10` to run instead of a test. |
| `program` | Env JSON only: the `.ic10` file the chip runs. |
| `chip` | Env JSON only: which chip runs `program`, if there's more than one. |
| `stopOnEntry` | Stop as soon as a chip runs its first line. |
| `debugTypeScript` | Also stop at breakpoints in the test's TypeScript. |
| `cwd` | The folder to run from. Its `vitest.config.*` is used, and Vitest and the harness are found from there. Left out, it's the nearest folder above the test or scenario with a `vitest.config.*`, or else a `package.json`. |
| `runtimeExecutable` | The Node.js to run with, if not the `node` on your `PATH`. |
| `args` | More arguments for `vitest run`, such as `["--reporter=verbose"]`. |
| `env` | More environment variables for the run, such as `{ "NODE_OPTIONS": "--max-old-space-size=4096" }`. |

## Settings

| Setting | Default | |
|---|---|---|
| `ic10-bench.codeLens` | `true` | Show **▶ Debug IC10** above tests. |
| `ic10-bench.debugTypeScript` | `false` | Debug the test's TypeScript as well. |

## Install

Search for **IC10 Bench** in the Extensions view, or run:

```
code --install-extension tasermonkey.ic10-bench
```

## Made with AI

Much of this extension, its tests and its documentation was written with Claude, Anthropic's AI assistant, working under the author's direction, code reviewing, with lots of back and forth debugging and tweaks to get it to the author's liking. The same goes for the [`@tasermonkey/ic10-bench`](https://github.com/tasermonkey/ic10-bench) harness it runs.  The [`@tasermonkey/ic10`](https://github.com/tasermonkey/ic10) project is a fork of the [Stationeers-ic/ic10](https://github.com/Stationeers-ic/ic10) project, and was brought up to date with the current game version at the time, and corrected the emulator to more closely follow what the game does.

Found something wrong? Please [open an issue](https://github.com/tasermonkey/ic10-bench/issues).

## Licence

AGPL-3.0-or-later (`LICENSE`). The bundle includes `@vscode/debugadapter` (MIT); its notice is in
`THIRD_PARTY_NOTICES.md`.

Working on the extension itself? See [CONTRIBUTING.md](CONTRIBUTING.md).
