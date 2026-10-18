# @tasermonkey/ic10-bench reference

What each builder method, option, handle, matcher and export does. For how to put them together, see the [README](README.md).

## Setting up a project

`npx @tasermonkey/ic10-bench init [<file.ic10> ...]` sets a folder of scripts up for testing. Each
step leaves alone anything already there, so running it again changes nothing.

### `init` options

| Option | Default | What it does |
|---|---|---|
| `<file.ic10> ...` | every script in the scripts folder | Write skeleton tests for just these scripts. |
| `--dir <folder>` | `ic10/` and its subfolders if there is one, else the `.ic10` files directly in the project folder | Where the scripts are. |
| `--no-install` | | Don't run `npm install`. |
| `--no-tests` | | Don't write skeleton tests. |
| `--yes` | | Don't ask before setting up in what looks like the game's own folder (a folder named `Stationeers` on the path). With no terminal to ask in, `init` stops there unless given this. |

### What `init` writes

| File | What `init` does |
|---|---|
| `package.json` | Writes one, or adds to yours: `"type": "module"` and the scripts `pretest` (`ic10-bench catalog`), `test` (`vitest run`), `test:watch` and `lint`. A script you already have is kept, except `npm init -y`'s failing `test`. `"type": "commonjs"` is kept if there are `.js` files it could matter to. |
| `vitest.config.ts` | `defineIc10Config({ test: { include: ["tests/**/*.test.ts"] } })`, unless there's a Vite or Vitest config already. |
| `tsconfig.json` | One that includes `tests/` and `ic10-bench-env.d.ts`, so your editor knows the prefabs. |
| `.gitignore` | Adds `node_modules/`, `.ic10-bench/` and `ic10-bench-env.d.ts`. |
| `node_modules/` | `npm install --save-dev` of ic10-bench, `vitest`, `@types/node` and `typescript`, if they aren't dependencies yet. |
| `.ic10-bench/`, `ic10-bench-env.d.ts` | The device catalogue, as `ic10-bench catalog` builds it. |
| `ic10-lint.json` | As `ic10-bench lint init` writes it, with `dir` set to the scripts folder. |
| `tests/<script>.test.ts` | A skeleton test per script, named after it (`Script1 [450].ic10` → `script1-450.test.ts`), in the same subfolder as the script has in the scripts folder (`ic10/rooms/lights.ic10` → `tests/rooms/lights.test.ts`). It's `it.skip`: add the devices on the script's pins, add checks, and remove `.skip`. |

### Setting up by hand

| Step | What to do |
|---|---|
| 1 | `npm init -y` if there's no `package.json`, then `npm pkg set type=module` and `npm install --save-dev @tasermonkey/ic10-bench vitest`. |
| 2 | A `vitest.config.ts` with `export default defineIc10Config();` (from `@tasermonkey/ic10-bench/config`): Vitest's own config with the IC10 matchers added. Pass your usual Vitest options in it. In watch mode (`npm run test:watch`), saving a `.ic10` file reruns the tests whose text has its file name; `defineIc10Config({ … }, { watchScripts: false })` turns that off. |
| 3 | The scripts `"pretest": "ic10-bench catalog"`, `"test": "vitest run"` and `"test:watch": "vitest"`, and `.ic10-bench/` and `ic10-bench-env.d.ts` in `.gitignore`: they hold the game's text. |
| 4 | A test, say `tests/airlock.test.ts`, then `npm test`. |

## Building a world (`sim()`)

`sim(options)` returns a builder. Each call adds to the world and returns the builder, and
`await .build()` gives you the [World](#world).

| Method | What it does |
|---|---|
| `device(key, prefab, props?, options?)` | Adds a device. `props` are its starting values, read-only ones included (a sensor's readings). See [Device options](#device-options). |
| `devices([...])` | Adds several devices, each given as `device()`'s arguments. For a table of them: `.devices(MACHINES.map(([key, prefab, id]) => [key, prefab, { On: 1 }, { id }]))`. |
| `housing(key, options)` | Adds a chip housing and the script its chip runs. See [Housing options](#housing-options). |
| `network(id)` | Adds a data network. Leave them all out and every device shares one. See [Data networks](#data-networks). |
| `mirror(key, options?)` | Adds a Logic Mirror, which stands in on its own network for a device on another. See [Mirror options](#mirror-options). |
| `pipe(key, init)` | Adds a pipe network of gas. See [Gas and models](#gas-and-models-experimental). |
| `room(key, init)` | Adds a sealed room (with a `volume`) or outside air (without one). See [Pipes and rooms](#pipes-and-rooms). |
| `build()` | Checks the declarations and builds the world. Async. |

The **key** you give each one is how the test refers to it (`world.device("vent")`). It isn't the
in-game name; give `{ name }` for that.

The **prefab** is the game's prefab name. A typo, or a property the prefab doesn't have, is a
compile error, and hovering a property shows what it is and whether it's read-only.
`npx ic10-bench props <prefab>` lists them (see the README's [Looking things up](README.md#looking-things-up)).

### `sim()` options

| Option | Default | What it does |
|---|---|---|
| `root` | the folder you run the tests from | Folder script paths are relative to. |
| `failOnHalt` | `false` | Fail the test as soon as a chip halts. |
| `maxTicks` | 10,000 | Ticks a `runUntil` / `runUntilLine` / `runToHalt` may take before failing. |
| `maxLinesPerRun` | 1,000,000 | Lines (all chips together) one run call may execute before failing. |
| `tickSeconds` | 0.5 | Game time per tick. |
| `linesPerTick` | 128 | Lines a chip runs before an automatic yield. |
| `countNonInstructionLines` | `true` | Blank, comment and label lines use up the per-tick budget, as in game. |
| `restartClearsState` | `false` | Switching a housing off and on also clears its chip's registers and stack. |
| `seed` | 1 | Seed for `rand`, so runs repeat exactly. |
| `traceLength` | 50 | Executed lines kept for failure reports and `recentLines`. |

### Device options

The fourth argument to `device()`. Housings and mirrors take `id`, `name` and `network` too.

| Option | Default | What it does |
|---|---|---|
| `id` | the next in a fixed sequence | Reference ID, as a number or the game's `$hex` form. |
| `name` | the prefab name | In-game name, for `lbn` / `sbn`. |
| `network` | the only network | Data network it's on. Required once you declare more than one. |
| `custom` | `false` | For a device neither the emulator nor your `ic10-mods/` knows: it gets every logic property, readable and writable. See the README's [Using modded devices](README.md#using-modded-devices). |
| `pipe` | none | The pipe it sits on, giving its own readings (a pipe analyzer). |
| `room` | none | The room it's in: a gas sensor's, or the room a vent blows into. |
| `ports` | none | Pipes on its ports (`input`, `input2`, `output`, `output2`), giving readings with that suffix (`PressureOutput`). |

### Housing options

The second argument to `housing()`. Give exactly one of `file` or `code`.

| Option | Default | What it does |
|---|---|---|
| `file` | | Path to an `.ic10` file, relative to `root`. |
| `code` | | The script inline, e.g. `"s db Setting 1\nyield"`. |
| `pins` | none | Which device key is on each pin `d0`…`d5`, e.g. `{ d0: "vent" }`. `db` is the housing itself. |
| `prefab` | `StructureCircuitHousing` | Another device that takes a chip: an air conditioner, a hardsuit. |
| `props` | none | Starting values for the housing's own properties (what `db` reads). |
| `linesPerTick`, `countNonInstructionLines`, `restartClearsState` | the world's | Override the `sim()` option for this chip. |

Plus `id`, `name`, `network`, `pipe`, `room` and `ports`, as for a device.

### Mirror options

The second argument to `mirror()`. A chip reads and writes the target through the mirror, with
`l` / `s`, or `ld` / `sd` with the mirror's ID. Batch instructions see a Logic Mirror.

| Option | Default | What it does |
|---|---|---|
| `target` | none | Key of the device it stands in for. With none, reads and writes through it halt the chip. |
| `powered` | `true` | Unpowered, reads through it are 0 and writes are dropped. |

Plus `id`, `name` and `network`, as for a device. `world.mirror(key)` gives its handle, with
`target`, `setTarget(key)`, `powered` and `setPowered(on)`.

### Data networks

If you don't declare any, every device shares one network, and batch instructions (`lb`, `sbn`, …)
see them all. To build a base with separate networks, declare each one (`.network("base")`,
`.network("outside")`) and put every device and housing on one of them with `{ network: "base" }`.
A chip's batch instructions then only see devices on its own network, and, as in game, its pins can
only be set to devices on its own network (anything else is a build error). To reach a device on
another network, use a [Logic Mirror](#mirror-options).

## World

### Running

Each run call is async, and only one can run at a time (a missing `await` is an error). A run that
goes too long fails with a message showing every chip's state and the last lines it ran, so a
script stuck in a loop doesn't hang the test.

| Call | What it does |
|---|---|
| `runTicks(n)` | Runs `n` ticks of game time. |
| `runSeconds(s)` | Runs `s` seconds of game time, rounded up to whole ticks. A tick is 0.5 s. |
| `runUntil(pred, { maxTicks }?)` | Runs whole ticks until `pred(world)` holds, checking before it starts and after every tick. Fails after `maxTicks`, or once every chip has stopped and no events are due. |
| `runUntilLine(labelOrIndex, { chip, maxTicks }?)` | Runs until a chip is about to run that line, and stops there, even mid-tick. If it's already there, it runs until it comes back. `chip` can be left out when there's only one. |
| `runToHalt({ maxTicks }?)` | Runs whole ticks until every chip has halted or ended. For one-shot scripts. `world.chip(key).runToHalt()` waits for just that chip. |
| `step(n = 1, chip?)` | Runs `n` lines of one chip, ignoring ticks: `yield` and `sleep` don't stop it, and no game time passes. Stops early if the chip halts or ends. |

`maxTicks` defaults to the [`sim()` option](#sim-options), 10,000.

### Scheduled events

Events run at the start of a tick, before any chip runs in it. An event is a function of the world,
and may be async. Each call returns a function that cancels it.

| Call | What it does |
|---|---|
| `at(when, event, options?)` | Runs `event` once, at `{ tick: n }` or `{ seconds: s }`. |
| `every(interval, event, options?)` | Runs `event` every `{ ticks: n }` or `{ seconds: s }`, starting one interval from now, or at `options.start` (a tick or seconds, as for `at`). |
| `when(pred, event, options?)` | Runs `event` whenever `pred(world)` becomes true, checked at the start of each tick. |

| Option | Default | What it does |
|---|---|---|
| `label` | the event function's name, or its kind | A name for the event, shown by the debugger and `listEvents()`. |

### Other members

| Member | What it does |
|---|---|
| `tick` | Ticks completed so far. |
| `time` | Game time, in seconds, at the start of the current (or next) tick. |
| `device(key)` / `chip(key)` | A device or chip by its key (see the handles below). |
| `listDevices()` | Every device, in the order declared. |
| `listChips()` | Every chip, in the order they run. |
| `deviceById(id)` | The device with that reference ID, or `undefined`. |
| `network(id)` | The devices on one data network: `.devices()`, `.byName(name)` (in-game name), `.byType(prefab)`. |
| `value(path)` | One value by path: `vent.On`, `ic.Stage` (a register or alias), `coolant.Temperature`. |
| `snapshot()` | Record every device property, chip register, pipe and room value right now and return it. |
| `diff(before)` | What changed since a snapshot. |
| `record(path)` | Records a value now and at the end of every tick from here on, for `toToggleAtMost`, `toBlink`, `toStayAt`. |
| `listEvents()` | Scheduled events still to come. |
| `listModels()` | What each model is attached to, in the order they run. |
| `pipe(key)` / `room(key)` | A pipe's or room's gas. |
| `refreshReadings()` | Updates devices' gas readings now, instead of at the start of the next tick. |

## Device handle (`world.device(key)`)

| Member | What it does |
|---|---|
| `key` | The test's key for it, e.g. `"vent"`. |
| `prefab` | Its prefab name. |
| `name` | Its in-game name (what `lbn` / `sbn` match). Defaults to the prefab name. |
| `id` / `idHex` | Its reference ID, as a number / as the game shows it (`$1488`). |
| `network` | The data network it's on. |
| `get(prop)` | A logic property's value. Throws if the device doesn't have it. |
| `set(prop, v)` | Sets a logic property, read-only ones included. |
| `add(prop, delta)` | Adds to a logic property. |
| `props(...names)` | The named properties, or every property with a value if none are named. |
| `stackAt(i)` | An entry in the device's own memory, which `put` / `get` on a pin write and read. |
| `slot(i)` | One of its slots (see below). |
| `pipe` / `room` | The pipe it sits on / room it's in, when attached. |
| `port(name)` | The pipe on one of its ports, when attached. |
| `readings` | Properties that come from its pipes and room, which `set` refuses. |

A **slot** (`world.device(key).slot(i)`):

| Member | What it does |
|---|---|
| `put(item, props?)` | Puts an item (by prefab name) in the slot, replacing what's there. `Quantity` defaults to 1. |
| `clear()` | Empties the slot. |
| `get(prop)` | A slot value as `ls` reads it (0 when empty). |
| `set(prop, v)` | Sets a value on the item in the slot. Throws if it's empty. |
| `occupied` | Whether there's an item in it. |

## Chip handle (`world.chip(key)`)

| Member | What it does |
|---|---|
| `reg(name)` | A register's value, by `r0`–`r17`, `sp`, `ra` or an alias. |
| `setReg(name, v)` | Sets a register, by name or alias. |
| `registers()` | Every register by raw name (`r0`…). |
| `sp` / `ra` | The stack pointer / return address. |
| `aliases()` | Aliases defined so far, by register, e.g. `{ r15: ["Stage"] }`. |
| `defines()` | Everything the script has defined so far: defines, aliases and labels. |
| `findLabel(name)` | A label's line, or `undefined`. |
| `stack()` | What's been pushed (the stack below `sp`). |
| `stackAt(i)` / `setStackAt(i, v)` | Reads / sets one stack entry, whatever `sp` is. |
| `line` | The line it runs next, or the line it halted on. 0-based. |
| `recentLines(n)` | The last `n` lines it ran (default 20). |
| `status` | Where it is, in one line: halted, ended, sleeping or the next line. |
| `halted` / `halt` | Whether it halted / why and where (`null` if it hasn't). |
| `errors` | Every error recorded on it, warnings included. |
| `ended` | It ran off the end of its program without an error. |
| `sleeping` | It's in a `sleep`. |
| `restarts` | The ticks it restarted from line 0 in, after its housing was switched back on. |
| `autoYields` | Times it ran out of lines in a tick and was yielded automatically. |
| `runToHalt()` | Runs whole ticks until this chip halts or ends. |
| `db` | Its housing's device handle. |
| `pins` | Which device key is on each pin, e.g. `{ d0: "vent" }`. |

## Matchers

Added to Vitest's `expect` by `defineIc10Config()`.

| Matcher | On | Passes when |
|---|---|---|
| `toHaveProps({ Mode: 1 })` | device, or chip (its housing) | Those properties have those values; others aren't checked. `expect.closeTo` works. |
| `toHaveRegister(name, v)` | chip | `r15`, `sp`, `ra` or an alias has the value. |
| `toHaveRegisterCloseTo(name, v, digits = 2)` | chip | Within `10^-digits / 2`. |
| `toHaveStack([...])` / `toHaveStackAt(i, v)` | chip | The stack below `sp` / one entry. |
| `toBeAtLine(index \| label)` | chip | It runs that line next, or halted on it. |
| `toHaveNoErrors()` | chip | Not halted, and no warnings (such as an alias that hides a built-in constant). |
| `toHaveHalted({ line, error })` | chip | Halted, optionally on that line with a matching message. |
| `toOnlyChange(paths, { since })` | world | Nothing else changed since a `world.snapshot()`. Paths can use aliases (`ic.Stage`) and `*`. |
| `toToggleAtMost(n)` | `world.record("vent.On")` | The value changed at most `n` times. Good for catching flapping. |
| `toBlink({ times = 2 })` | a recording | It changed at least twice: on, off and on again. For a warning light. |
| `toStayAt(v)` | a recording | It was `v` at every sample. `expect.closeTo` works. |
| `toNeverAutoYield()` | chip | Never ran out of its 128 lines in a tick. |
| `toAutoYieldAtMost(n, { perTicks })` | chip | At most `n` automatic yields, in total or in any window. |

## Script checks

`describeScriptChecks(options?)`, from `@tasermonkey/ic10-bench/checks`, makes a set of tests for
each `.ic10` file in your scripts folder (`ic10/` unless `ic10-lint.json` says otherwise).

### Tests

The tests it makes for each script:

| Test | Checks |
|---|---|
| `limits` | 128 lines, 90 characters a line and 4096 characters, counted as the game counts them. |
| `loads` | The script loads: syntax, argument counts, aliases, defines and labels. |
| `devices` | Batch instructions (`lb`, `sbn`, …) use logic types their devices have, mods' devices included; `HASH()` of a number or of a prefab that doesn't exist. |
| `style` | Relative branches given a label, jumps to line numbers, unused aliases, defines and labels. |
| `idle` | Run for 50 ticks against stand-in devices, it doesn't halt or run out of lines (a loop with no `yield`). See [The idle test](#the-idle-test). |

### `describeScriptChecks()` options

Where it looks for your project and its config:

| Option | Default | What it does |
|---|---|---|
| `root` | the project `defineIc10Config` set, or the working directory | The project's folder. |
| `config` | `ic10-lint.json` in the project's folder | The config file to read. |

### Configuration

The checks are [@tasermonkey/ic10-lint](https://github.com/tasermonkey/ic10-bench/tree/main/packages/ic10-lint#readme)'s
rules, and they read its config, `ic10-lint.json`, which sets:

- which folder the scripts are in;
- rules turned off or down to warnings (a test then passes and shows the finding as a warning);
- overrides for a script that's already over a limit.

`"idle": "warn"` or `"off"` in its `rules` sets the idle test's severity, for every script or, in an
override's `rules`, for one. `npx ic10-bench lint init` writes a starting `ic10-lint.json`.

### The idle test

The `idle` test builds no world of its own, so it stands in for every device the script could
reach: one on each pin `d0`–`d5`, and one at each reference ID the script writes as a whole number
(`$1488`, `797452`). A stand-in has every logic type and every slot, and they all read 0. The
housing answers any logic type too, for a chip meant to sit in another device (an air conditioner,
a suit) and read it through `db`; its own logic types keep their rules. So the test runs the paths
a script takes with its devices empty, off or at rest, and a loop that waits on one of them without
a `yield` fails it. A script that finds a device by an ID it works out (`ld r0 r1 On` with `r1`
computed) can still miss one, and that skips the test ("needs devices").

## Gas and models (experimental)

The gas is simpler than the game's: ideal gas, perfectly mixed, no condensing or boiling. Rates the
game keeps in asset files are guesses, and each model takes an option to change them.

### Pipes and rooms

`.pipe(key, init)` and `.room(key, init)` on the builder. Give `gases`, or `pressure` and `ratios`.

| Field | For | What it does |
|---|---|---|
| `volume` | pipe; sealed room | Litres. `PIPE_VOLUME` is one 10 L pipe segment, `GRID_VOLUME` one 8000 L grid cell. A room without one is outside air (below). |
| `temperature` | all | Kelvin. |
| `gases` | pipe, sealed room | Moles of each gas, e.g. `{ Nitrogen: 4 }`. |
| `pressure` | all | kPa, with `ratios`. |
| `ratios` | all | Share of each gas, with `pressure`. Normalised, so `{ Nitrogen: 7, Oxygen: 3 }` works. |

A room with no `volume` is **outside air**: too big for anything to change, so it stays as set
until the test sets new weather.

### Attaching devices

Device options on `.device()` or `.housing()`.

| Option | What it does |
|---|---|
| `pipe` | The pipe it sits on, giving its own readings (a pipe analyzer). |
| `room` | The room it's in: a gas sensor's readings, or the room a vent blows into. |
| `ports` | Pipes on its ports, `{ input, input2, output, output2 }`. A vent's one pipe is its `output`. |

An attached device's `Pressure`, `Temperature`, `TotalMoles` and `Ratio<Gas>` come from the gas, with
the port's suffix (`PressureOutput`, `RatioNitrogenInput`), and can't be `set` directly.

### Reading the gas

| Call | What it does |
|---|---|
| `world.pipe(key)` / `world.room(key)` | The gas: a `Mixture`, or a `Reservoir` for outside air. |
| `world.value("coolant.Temperature")` | One value by path: `Pressure`, `Temperature`, `TotalMoles`, `Volume`, `Ratio<Gas>`, or a gas's name for its moles. These paths also work in `record` and snapshots. |
| `world.refreshReadings()` | Updates attached devices' readings now, instead of at the start of the next tick. |

### Models

`world.model(key, model)` attaches a model to a device; a world model goes in on its own,
`world.model(model)`. Models run at the start of every tick, after scheduled events and before the
chips, so a setting a script writes in one tick acts in the next. A device model only works while
the device is `On`; power isn't modelled.

| Model | Kind | What it does |
|---|---|---|
| `activeVent(options?)`, `poweredVent(options?)` | device | Moves gas between its `output` pipe and its room, honouring `Mode` and the pressure limits. |
| `volumePump(options?)` | device | Moves `Setting` litres a tick from `input` to `output`. |
| `pressureRegulator(options?)` | device | Moves gas from `input` to `output` until the output rises to `Setting`. |
| `backPressureRegulator(options?)` | device | Moves gas from `input` to `output` until the input falls to `Setting`. |
| `filtration(options?)` | device | Sends filtered gases to `output`, the rest to `output2`. |
| `airConditioner(options?)` | device | Heats or cools gas from `input` to `output` toward `Setting` K, using `output2` as the waste pipe. |
| `battery(options?)` | device | Sets `Charge`, `Ratio` and `Mode` from watts in and out. |
| `occupancySchedule(windows, options?)` | device | Sets an occupancy sensor's `Quantity` and `Activate` over time. |
| `larreDock(options)` | device | A hydroponics Larre arm moving along its rail, planting and harvesting. |
| `heatExchange(a, b, options)` | world | Moves two pipes, or a pipe and a room, toward a shared temperature. |
| `dayNight(options)` | world | Day/night temperature on a room, and the sun on daylight sensors. |
| your own function | either | `world.model("lamp", (lamp, dt, w) => { … })` gets the device, the tick's length in seconds and the world; a world model gets `(dt, w)`. |

`world.model()` returns a function that removes the model.

### Model options

#### Vents

| Option | Default | What it does |
|---|---|---|
| `pressurePerTick` | 10 (active), 50 (powered) | The most it moves in a tick, as kPa of one grid cell of its room. |

#### Volume pump

| Option | Default | What it does |
|---|---|---|
| `maxSetting` | 10 | The highest `Setting` it acts on, in litres a tick. |

#### Pressure regulators

| Option | Default | What it does |
|---|---|---|
| `pressurePerTick` | 101.325 | The least it moves in a tick, as kPa of one pipe segment. With the input higher, it moves at least a quarter of what would even the pipes out. |

#### Filtration

| Option | Default | What it does |
|---|---|---|
| `gases` | the filters in its two filter slots | The gases it filters, e.g. `["CarbonDioxide"]`. |
| `pressurePerTick` | 101.325 | The least it draws from its input in a tick, as kPa of one pipe segment. |

#### Air conditioner

| Option | Default | What it does |
|---|---|---|
| `pressurePerTick` | 101.325 (about 4 mol a tick at 300 K) | Input gas through it each tick, as kPa of 100 L. |
| `temperatureDifferentialEfficiency` | 1 at 0 K, falling to 0 at 200 K | Efficiency, 0 to 1, from how far it pumps heat uphill (K). |
| `operationalTemperatureEfficiency` | 1 | Efficiency, 0 to 1, from the lower of the gas's and the waste's temperature. |

#### Battery

`generation` and `usage` are watts, read each tick: a number, a device key (its `PowerGeneration` or
`RequiredPower`), a `"key.Prop"` path, a list of those (summed), or a function of the world.

| Option | Default | What it does |
|---|---|---|
| `generation` | 0 | What charges it. |
| `usage` | 0 | What it supplies. |
| `capacity` | the device's `Maximum`, or its prefab's | Joules it holds when full. |
| `lossPerTick` | 10 | Joules it loses each tick on its own. |

#### Occupancy schedule

Each window is `{ from, to, people? }`: the first tick, the tick it ends at (not included), and how
many people (default 1). Overlapping windows add up.

| Option | Default | What it does |
|---|---|---|
| `everyTicks` | runs once | Repeat the schedule every this many ticks. |

#### Heat exchange

`heatExchange(a, b, options)` takes the keys of two pipes, or a pipe and a room.

| Option | Default | What it does |
|---|---|---|
| `fraction` | required | How far the two move toward a shared temperature each tick, 0 to 1. Tune it to how fast the build cools in game. |

#### Day and night

| Option | Default | What it does |
|---|---|---|
| `dayTicks` | 2400 (the game's 1200 s day) | Ticks in a day. |
| `startAt` | 0 | Where in the day tick 0 falls: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. |
| `room` | none | The room whose temperature follows the day. |
| `temperature` | none | `{ night, day }` in Kelvin, following a sine between them. Needed with `room`. |
| `sensors` | none | Daylight sensor keys that follow the sun. |
| `irradiance` | 1367 | Sunlight with the sun overhead, W/m². |

#### Larre dock

| Option | Default | What it does |
|---|---|---|
| `stations` | required | Junctions on the rail, numbered from the starting dock, 0. |
| `planters` | none | Stations with a planter: its plant (below), or `null` for an empty one. |
| `dropOff` | none | Stations with an import bin, where the arm drops what it holds. |
| `jammed` | `false` | The bins keep what's dropped, so the next drop does nothing. |
| `nodes` | 1 | Rail nodes between stations: one number, or by station. |
| `speed` | 1 | Rail nodes a second. |
| `looping` | `false` | The rail is a loop: `Setting` wraps and the arm takes the shorter way. |
| `start` | 0 | The station the arm starts at. |
| `hand` / `extra` | empty | What the arm holds at the start, `{ item, quantity }`, in slot 0 / slot 1. |
| `stackSize` | 50 | Most of one item a stack holds. |

A plant is `{ item, fruit, seed, mature, seeding, seeds, harvest, perennial }`, all optional. It
doesn't grow: it stays as set until the arm takes from it.

`larreDock()` returns the dock: pass its `model` to `world.model()`, then check `visited` (stations
it stopped at), `delivered` (what it dropped in a bin), `hand`, `extra`, `station` (-1 while moving)
and `planter(station)`.

## Other exports

| Export | What it does |
|---|---|
| `Color`, `VentMode`, `LedMode` | The game's enums, by the names a script uses (`Color.Green`). |
| `hash(name)` | The game's `HASH()`. |
| `press(world, key, prop?)` | Presses a button: sets `prop` (default `Activate`) to 1, and back to 0 next tick. |
| `readScript(path)` | Reads a `.ic10` file. |
| `findScripts(dir)` | Every `.ic10` file under a folder. |
| `Mixture`, `Reservoir` | The gas classes, for working with gas outside a world. |
| `describeScriptChecks()` | From `@tasermonkey/ic10-bench/checks`: the [script checks](#script-checks). |
| `testsNamingScript(root, script, include?, exclude?)` | From `@tasermonkey/ic10-bench/related-tests`: the test files under `root` whose text has the script's file name, the ones watch mode reruns when it changes. Doesn't load Vitest. |
| `checkBatchOps(source, catalog)` | The `devices` check on its own, for one script. |
