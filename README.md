# IC10 Bench

Automated tests for your [Stationeers](https://store.steampowered.com/app/544550/Stationeers/) IC10
scripts, and a VS Code debugger to step through them while the tests run.

You describe the devices a chip is wired to, run the script for some game ticks, and check what it
did: which devices it changed, what's in its registers, whether it halted. Scripts run on an IC10
emulator that follows the game's rules (128 lines a tick, errors halt the chip, and so on), in the
[Vitest](https://vitest.dev/) test framework. No game needed.

| Package | What it is |
|---|---|
| [`@tasermonkey/ic10-bench`](packages/ic10-bench/) | The test harness, from npm. Start here: its README walks through setting up a project. |
| [IC10 Bench for VS Code](packages/vscode/) | The debugger: breakpoints in `.ic10` files, registers, stack and devices while a test runs. |

The emulator is [`@tasermonkey/ic10`](https://github.com/tasermonkey/ic10), a fork of
[Stationeers-ic/ic10](https://github.com/Stationeers-ic/ic10) changed to follow the game more
closely. Everything here is licensed under the [GNU AGPL-3.0](LICENSE) or later.

## Working on it

You'll need [Node.js](https://nodejs.org/) 24 or later.

```
git clone --recurse-submodules https://github.com/tasermonkey/ic10-bench.git
cd ic10-bench
npm install
npm test
```

The emulator is a git submodule (`vendor/ic10`), so the harness runs against its source. Each
package's CONTRIBUTING.md covers its internals; [TEST_FRAMEWORK_PLAN.md](TEST_FRAMEWORK_PLAN.md) is
the design and its history.
