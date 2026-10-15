# IC10 Bench

Automated tests for your [Stationeers](https://store.steampowered.com/app/544550/Stationeers/) IC10
scripts, and a VS Code debugger to step through them while the tests run.

You can setup a simulation, to run the chips in, thanks to `Stationeers-ic`.  Then using the [Vitest](https://vitest.dev/) test framework, you can create describe/it tests with expects.  This test bench has a bunch of extensions to vitest to help writing the expectation.  With the overal goal, of helping AI generate valid working IC10 code, since now it and you will be able to write tests that your IC10 code can be tested against.  To help with quality, I also took some of FlorpyDorp's linter and made it into a seperate linter package (so that the AI can run it as a command).  The end goal here will probably be to make FlorpyDorp's linter do all of this and present a CLI as well testing it.  Though my version of the linter, allows me to make a eslint style of config file, to disable certain rules on certain files.

| Package | What it is |
|---|---|
| [`@tasermonkey/ic10-bench`](packages/ic10-bench/) | The test harness, from npm. Start here: its README walks through setting up a project. |
| [IC10 Bench for VS Code](packages/vscode/) | The debugger: breakpoints in `.ic10` files, registers, stack and devices while a test runs. |
| [`@tasermonkey/ic10-lint`](packages/ic10-lint/) | Static checks, with no tests to write: the game's size limits, scripts that won't load, batch instructions against the devices, common mistakes. A command line for CI, and the checks behind the harness's `describeScriptChecks()`. |

# Usage Requirements
- You'll need [Node.js](https://nodejs.org/) 24 or later.  This is because I like typescript, and to run scripts directly in node.  And 24+ adds type striping natively when it runs.
- You don't really need vscode, but it was designed with it in mind.  Though just developing with AI you can just point it to the library so that it knows to use this for testing and executing of your scripts.
- See the subpackages README files for more information.

## Contributing

See [Contributing](./CONTRIBUTING)

# Thanks
- [Stationeers-ic/ic10](https://github.com/Stationeers-ic/ic10) - An emulator for running IC10 code, I had to fork it here  [`@tasermonkey/ic10`](https://github.com/tasermonkey/ic10).
- [IC10 language server](https://github.com/FlorpyDorpinator/FlorpyDorp-IC10-Language-Support) - The basis of the ic10-lint CLI / package.

## About

My work wanted me to play more with AI to learn how to better use it.  I enjoy this game, and have been helping random people here and there debug their scripts, and reading reddit, I have spotted more and more people using AI to make IC10 code.  To which I don't blame them, especially to a non-engineer, it can be a hard thing to get into.  However, AI is here, so I also think adding tooling to help AI be better can be a good thing.  So this was written for AI. 

### Why I built this
> Every Stationeer has a story about the divide by zero that turned their base into a fireball.

My hope is that IC10 Bench makes testing cheap enough to be worth doing for IC10: that players, and
the AI tools they use, write tests alongside their scripts, catch bugs before they cause a base to
explode, and share scripts that come with proof they work. [More on why](WHY.md).
