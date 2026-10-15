# IC10 Bench for VS Code reference

Launch configurations and settings. For how to debug a test or a scenario, see the
[README](README.md).

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

| Setting | What it does |
|---|---|
| `test` | The test file to debug. |
| `line` | The line of the `it(...)` or `describe(...)` to run. Leave it out to run the whole file. |
| `scenario` | A world module, env JSON or `.ic10` to run instead of a test. See [SCENARIOS.md](SCENARIOS.md). |
| `program` | Env JSON only: the `.ic10` file the chip runs. |
| `chip` | Env JSON only: which chip runs `program`, if there's more than one. |
| `stopOnEntry` | Stop as soon as a chip runs its first line. |
| `debugTypeScript` | Also stop at breakpoints in the test's TypeScript. |
| `cwd` | The folder to run from. Its `vitest.config.*` is used, and Vitest and the harness are found from there. Left out, it's the nearest folder above the test or scenario with a `vitest.config.*`, or else a `package.json`. |
| `runtimeExecutable` | The Node.js to run with, if not the `node` on your `PATH`. |
| `args` | More arguments for `vitest run`, such as `["--reporter=verbose"]`. |
| `env` | More environment variables for the run, such as `{ "NODE_OPTIONS": "--max-old-space-size=4096" }`. |

## Settings

| Setting | Default | What it does |
|---|---|---|
| `ic10-bench.codeLens` | `true` | Show **▶ Debug IC10** above tests. |
| `ic10-bench.debugTypeScript` | `false` | Debug the test's TypeScript as well. |
