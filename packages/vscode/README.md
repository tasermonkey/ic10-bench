# IC10 Bench for VS Code

Run and Test your Stationeers IC10 scripts with [Vitest](https://vitest.dev/) tests, and step through them
in the VS Code debugger. Set a breakpoint in a `.ic10` file, start the test, and you can see every
register, the stack and every device, change values, and step a line or a game tick at a time.

The tests use [`@tasermonkey/ic10-bench`](https://github.com/tasermonkey/ic10-bench/tree/main/packages/ic10-bench#readme), which runs your scripts in an emulator under the game's rules: game ticks, the 128-line automatic yield, `sleep`, and a chip halting on an error.

## Usage

The extension debugs tests written with `@tasermonkey/ic10-bench`, so set that up first: follow
its [Getting started](https://github.com/tasermonkey/ic10-bench/tree/main/packages/ic10-bench#getting-started).
New to writing tests? See the [tutorial](https://github.com/tasermonkey/ic10-bench/blob/main/packages/ic10-bench/TUTORIAL.md) walks through a first script and test. Then see [Debugging a test](#debugging-a-test) below.

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

To watch a script run in a setup without writing a test, write a **scenario**: a `x.world.ts` that
builds a world, or an emulator env JSON. Open it, or the `.ic10` beside it, and click **Debug IC10
Scenario** in the editor title. See [SCENARIOS.md](SCENARIOS.md) for both formats.

## Debugging the TypeScript too

If you also want to stop in the test's own code (a model, an event, an expectation), turn on the
setting **IC10 Bench: Debug TypeScript**. Breakpoints in `.ts` files then stop as well, in a second
session under the IC10 one in Call Stack. While the TypeScript is stopped, the IC10 side shows as
running. Stopping either session ends both.

## Try it

[`examples/`](examples/) has one small test and script for each feature, with what to try written
at the top of each script.

## Launch configurations

You don't need a `launch.json`, but you can add one to save a setup: a test to debug, or a
scenario to run. Every setting it takes is in [REFERENCE.md](REFERENCE.md#launch-configurations).

## Settings

Two settings: whether **▶ Debug IC10** shows above tests, and whether to debug the test's
TypeScript too. See [REFERENCE.md](REFERENCE.md#settings).

## Install

Search for **IC10 Bench** in the Extensions view, or run:

```
code --install-extension tasermonkey.ic10-bench
```

## Why I built this

> Every Stationeer has a story about the divide by zero that turned their base into a fireball.

My hope is that IC10 Bench makes testing cheap enough to be worth doing for IC10: that players, and
the AI tools they use, write tests alongside their scripts, catch bugs before they cause a base to
explode, and share scripts that come with proof they work.
[More on why](https://github.com/tasermonkey/ic10-bench/blob/main/WHY.md).

## Made with AI

Much of this extension, its tests and its documentation was written with Claude, Anthropic's AI assistant, working under the author's direction, code reviewing, with lots of back and forth debugging and tweaks to get it to the author's liking. The same goes for the [`@tasermonkey/ic10-bench`](https://github.com/tasermonkey/ic10-bench) harness it runs.  The [`@tasermonkey/ic10`](https://github.com/tasermonkey/ic10) project is a fork of the [Stationeers-ic/ic10](https://github.com/Stationeers-ic/ic10) project, and was brought up to date with the current game version at the time, and corrected the emulator to more closely follow what the game does.

Found something wrong? Please [open an issue](https://github.com/tasermonkey/ic10-bench/issues).

## Licence

AGPL-3.0-or-later (`LICENSE`). The bundle includes `@vscode/debugadapter` (MIT); its notice is in
`THIRD_PARTY_NOTICES.md`.

Working on the extension itself? See [CONTRIBUTING.md](CONTRIBUTING.md).
