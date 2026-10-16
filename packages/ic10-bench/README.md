# @tasermonkey/ic10-bench

Automated tests for your Stationeers IC10 scripts. You describe the devices a chip is wired to,
run the script for some game ticks, and check what it did: which devices it changed, what's in its
registers, whether it halted. Scripts run on an IC10 emulator that follows the game's rules (128 lines
a tick, errors halt the chip, and so on), in the [Vitest](https://vitest.dev/) test framework.

## Example
```ts
import { expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-bench";

it("opens the vent when it gets hot outside", async () => {
	const world = await sim({ root: import.meta.dirname })
		.device("vent", "StructureActiveVent")
		.device("sensor", "StructureGasSensor", { Temperature: 300 })
		.housing("ic", { file: "vent.ic10", pins: { d0: "vent", d1: "sensor" } })
		.build();

	world.at({ tick: 20 }, (w) => w.device("sensor").set("Temperature", 450));
	await world.runTicks(30);

	expect(world.device("vent")).toHaveProps({ Mode: 0, On: 1 });
	expect(world.chip("ic")).toHaveRegister("OutsideTemp", 450); // aliases work
	expect(world.chip("ic")).toHaveNoErrors();
});
```

## Sister Project
There's also a [VS Code debugger](https://github.com/tasermonkey/ic10-bench/tree/main/packages/vscode#readme)
for stepping through a script while its test runs.

## Why I built this

> Every Stationeer has a story about the divide by zero that turned their base into a fireball.

My hope is that IC10 Bench makes testing cheap enough to be worth doing for IC10: that players, and
the AI tools they use, write tests alongside their scripts, catch bugs before they cause a base to
explode, and share scripts that come with proof they work.
[More on why](https://github.com/tasermonkey/ic10-bench/blob/main/WHY.md).

## Getting started

With [Node.js](https://nodejs.org/) 24 or later, in the folder with your scripts:

```
npx @tasermonkey/ic10-bench init
```

That sets the folder up for testing (package.json, Vitest, the packages, the device catalogue) and
writes a skipped skeleton test for each script in `tests/`. Fill one in, remove its `.skip`, and
run `npm test`. Running `init` again changes nothing it already did; `init <file.ic10>` adds a
skeleton for a new script. Its options, what it writes, and how to set up by hand are in
[REFERENCE.md](REFERENCE.md#setting-up-a-project). New to this? [TUTORIAL.md](TUTORIAL.md) walks
through a first script and test, line by line.

Script paths are relative to `root`. `sim({ root: import.meta.dirname })` means "next to this test
file"; leave it out and they're relative to the folder you run the tests from.

## Building a world

`sim()` returns a builder. Add devices, then housings with chips in them, then `.build()`.

```ts
const world = await sim({ root: import.meta.dirname })
	.device("vent", "StructureActiveVent", { On: 0 })                     // key, prefab, starting values
	.device("light", "StructureWallLight", {}, { name: "Alarm" })          // a name for lbn / sbn
	.housing("ic", { file: "airlock.ic10", pins: { d0: "vent" } })       // the chip, and what's on its pins
	.housing("helper", { code: "s db Setting 1\nyield" })                 // or the script inline
	.build();
```

The **key** (`"vent"`) is how the test refers to a device; the **prefab** is the game's name for
it, checked as you type. Every builder method and option, including separate data networks,
is in [REFERENCE.md](REFERENCE.md#building-a-world-sim).

## Emulation env file

**From an env file.** If you already have the emulator's env JSON, `World.fromEnv(env, options)`
builds a world from it. Devices are keyed by their `name` when it's unique, otherwise by reference
ID (`world.device("$300")`). `{ programs: { Controller: "controller.ic10" } }` runs a housing's chip
from a file.

## Running it

Run actions on the `sim()` world. Advance game time by ticks or seconds, run until something holds or
a chip reaches a line, or step a chip line by line:

```ts
await world.runTicks(30);                                          // a tick is 0.5 s
await world.runUntil((w) => w.device("vent").get("On") === 1);
await world.runUntilLine("wait", { chip: "ic" });
```

Every run call, and what it does, is in [REFERENCE.md](REFERENCE.md#running).

A run that goes too long (10,000 ticks by default) fails with a message showing every chip's state
and the last lines it ran, so a script stuck in a loop doesn't hang the test.

## Changing things as its running

So between each of the 'Run actions' above, you can modify the world state as follows:

```ts
world.device("sensor").set("Temperature", 280);       // read-only properties too
world.device("sorter").slot(0).put("ItemIronOre", { Quantity: 10 });
world.device("ic").set("On", 0);                      // switch a housing off; on again restarts the chip
world.chip("ic").setReg("Stage", 2);
```

### Schedule events
Or schedule it. Events can modify state at the start of a tick, before any chip continues its execution:

```ts
world.at({ tick: 20 }, (w) => w.device("sensor").set("Temperature", 450));
world.at({ seconds: 60 }, ...);
const stop = world.every({ ticks: 60 }, (w) => w.device("sensor").add("Temperature", -40), { label: "nightfall" });
world.when((w) => w.device("vent").get("On") === 1, (w) => w.device("light").set("On", 1));
// ...
stop();
```

Each returns a function that cancels it. See [REFERENCE.md](REFERENCE.md#scheduled-events) for
the details.

## Checking results

### Read values directly

```ts
world.device("vent").get("Mode");
world.device("sorter").slot(0).get("Quantity");
world.chip("ic").reg("Stage");      // a register or alias
world.chip("ic").stackAt(4);
world.chip("ic").halted;
```
### Matchers
Preferable, you would use vitest matchers, which explain what went wrong when they fail:

```ts
expect(world.device("vent")).toHaveProps({ Mode: 0, On: 1 });
expect(world.chip("ic")).toHaveRegister("Stage", 2);
expect(world.chip("ic")).toHaveNoErrors();
expect(world.chip("ic")).toBeAtLine("wait");
```

They cover device properties, registers and the stack, where a chip is and whether it halted,
what changed since a snapshot, how a recorded value moved, and automatic yields. See
[REFERENCE.md](REFERENCE.md#matchers) for the full list.

A failure shows the chip's current line, its registers with their aliases, the stack, the devices on
its pins, and the last lines it ran.

To compare with the game's enums, `Color`, `VentMode` and `LedMode` have their values, by the names a
script uses: `expect(world.device("light")).toHaveProps({ Color: Color.Green })`, `VentMode.Inward`,
`LedMode.Power`.

## How it differs from what you might expect

- **Line numbers are 0-based** and count every line, comments and blanks included, like the game's
  `LineNumber`.
- **A halt isn't a test failure.** The chip stops and the housing's `Error` goes to 1, as in game;
  check for it with `toHaveNoErrors()`. Build with `sim({ failOnHalt: true })` to fail at once instead.
- **Writing to a property a device doesn't have, or a read-only one, halts the chip**, as in game. The
  message names the device and lists what it does have.
- **Switching a housing off and on restarts its chip** from line 0. Off and on again within one tick
  goes unnoticed, so a script restarting another chip has to `yield` in between.
- **Chips take turns in the order you declared them**, and each sees the others' writes at once.
- **`sleep` doesn't wait in real time**; it yields, then does not continue executing for a specified
  amount of time.  Other chips, events, etc will continue to run.

## Experimental
### Pipes, rooms and device behaviour

By default devices are just bags of values: a vent you switch on doesn't move any gas, and a sensor
reads whatever the test sets. When your script's logic depends on the physical result (it waits
for a pipe to empty, a room to warm up), give it gas to work on and models to move it.

So I setup the emulator to be able to do some simulation of gases.

```ts
const world = await sim({ root: import.meta.dirname })
	.pipe("coolant", { volume: 10 * PIPE_VOLUME, temperature: 150, pressure: 50, ratios: { CarbonDioxide: 1 } })
	.room("outside", { temperature: 150, pressure: 20, ratios: { CarbonDioxide: 95, Nitrogen: 5 } })
	.device("pa",   "StructurePipeAnalysizer", {}, { pipe: "coolant" })
	.device("vent", "StructureActiveVent",     {}, { ports: { output: "coolant" }, room: "outside" })
	.device("out",  "StructureGasSensor",      {}, { room: "outside" })
	.build();

world.model("vent", activeVent());
```

A device attached to a pipe or room reads its `Pressure`, `Temperature` and gas ratios from it.
**Models** make devices act on the world each tick: vents, pumps, regulators, filtration, air
conditioners, batteries, heat exchange, day and night, and more, or one you write. The gas is
simpler than the game's (ideal gas, perfectly mixed, no condensing or boiling).

Pipe and room fields, attaching devices, every model and its options are in
[REFERENCE.md](REFERENCE.md#gas-and-models-experimental).

## The device catalogue

The harness knows every device the emulator has: its logic types, whether each is readable or
writable, its slots and modes. `sim().device()` is type-checked against it, so a misspelt prefab or
property is an error in your editor, before the test even runs.

`npx ic10-bench catalog` (npm `pretest` script) adds two things for the project:

- **Descriptions** of every logic type, from your Stationeers install.
- **Your mods' devices**, if you've added any (next section).

It writes `.ic10-bench/catalog.json` and `ic10-bench-env.d.ts`. TypeScript picks up the
`.d.ts` as long as your `tsconfig.json` includes the project folder. Run it
again after a game update.

## Using modded devices

Devices from workshop mods aren't in the emulator library, but you can add them, so a test can use them like
any other device:

1. Export the game's device list. Install the
   [StationeersStationpediaExtractor](https://github.com/Ryex/StationeersStationpediaExtractor)
   BepInEx plugin (`StationpediaExtractor.dll` into `BepInEx/plugins/`), start the game with your
   mods, load a save, and run `stationpedia_export` in the F3 console. It writes
   `<Stationeers>/Stationpedia/Stationpedia.json` and `Enums.json` (which `catalog` also reads
   descriptions from).
2. In your project, run:
   ```
   npx ic10-bench import-mods
   npx ic10-bench catalog
   ```
   `import-mods` reads the export and writes every device the emulator doesn't have to
   `ic10-mods/<machine id>.json`: its name, hash, logic types with read/write, slots and modes (no
   game text). Pass the export's folder if the game isn't where Steam says:
   `npx ic10-bench import-mods "D:/Games/Stationeers/Stationpedia"`. `catalog` then adds them to
   the types.
3. Commit `ic10-mods/`. Each machine writes its own file (the id is random, and kept in
   `.ic10-bench/machine.json`), so two people with different mods never edit the same file; the
   harness reads them all, and yours wins where they disagree.

Then use them by prefab name:

```ts
const world = await sim()
	.device("button", "ModularDeviceRoundButton", { Activate: 1 })
	.housing("ic", { file: "button.ic10", pins: { d0: "button" } })
	.build();
```

Run both commands again after adding or updating a mod. Tests run with the devices in `ic10-mods/`
even before `catalog`; only the types need it.

For a device in no export at all, pass `{ custom: true }`: it gets every logic property, readable
and writable.

## Looking things up

`npx ic10-bench` answers "what does this device have?" without opening the game:

```
npx ic10-bench props StructureActiveVent    # logic types with R/W and descriptions, modes, slots
npx ic10-bench props round button           # search by words of the name
npx ic10-bench props 489382030              # by hash
npx ic10-bench logic PressureInternal       # what it is, and every prefab that has it
```

## Linting Scripts

Some mistakes need no test written for them: a script too long for the chip, a line the game will
cut, a misspelt alias, an `sb` of a logic type the device doesn't have, a loop with no `yield`. One
test file checks all your scripts for them:

```ts
// tests/scripts.test.ts
import { describeScriptChecks } from "@tasermonkey/ic10-bench/checks";

describeScriptChecks();
```

For each `.ic10` file under `ic10/`, that makes a test for each group of checks: limits, loading,
devices, style, and a short idle run that catches a loop with no `yield`. Turn rules off or down to
warnings in `ic10-lint.json`; `npx ic10-bench lint init` writes a starting one. The checks, the
config and how the idle run works are in [REFERENCE.md](REFERENCE.md#script-checks).

`npx ic10-bench lint` runs the same checks (all but `idle`) from the command line, without Vitest:
for CI or a pre-commit hook. It exits with 1 when there's an error.

## Debugging

Install the [VS Code extension](https://github.com/tasermonkey/ic10-bench/tree/main/packages/vscode#readme), set a breakpoint in your `.ic10` file, and
click **▶ Debug IC10** above the test. You can step line by line, watch registers and devices, and
step a tick at a time. Tests need no changes.

## Reference

[REFERENCE.md](REFERENCE.md) lists every `sim()` builder method and option, the script checks, the gas and its models, what each member of the world, device
and chip handles does, every matcher, and the other exports.

## Made with AI

Much of this harness, its tests and its documentation was written with Claude, Anthropic's AI
assistant, working under the author's direction, with the author reviewing the code and a lot of
back-and-forth debugging and tweaking to get it right. The same goes for the
[VS Code extension](https://github.com/tasermonkey/ic10-bench/tree/main/packages/vscode#readme).
The emulator it runs on, [`@tasermonkey/ic10`](https://github.com/tasermonkey/ic10), is a fork of
[Stationeers-ic/ic10](https://github.com/Stationeers-ic/ic10), brought up to date with the current
game and corrected to follow more closely what the game does.

Found something wrong? Please [open an issue](https://github.com/tasermonkey/ic10-bench/issues).

Working on the harness itself? See [CONTRIBUTING.md](CONTRIBUTING.md).
