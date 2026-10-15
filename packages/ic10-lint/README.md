# @tasermonkey/ic10-lint

Checks your Stationeers IC10 scripts meet some minimal standards. Use it from the command line, in CI or a pre-commit hook, or from your tests through vitest via [IC10 Bench](https://github.com/tasermonkey/ic10-bench/tree/main/packages/ic10-bench).

This is to help AI keep its code more sane as it generates IC10 code.

## Example output:
```
$ npx ic10-lint
ic10/Big Script.ic10:129:1 error max-lines 162 lines; the game keeps 128, so lines 129 to 162 are lost (31 lines of code)
ic10/Air.ic10:11:91 warning max-columns 128 characters; the game cuts the line at 90, losing the end of the comment
ic10/Lights.ic10:2:7 warning unused alias Sensor2 is never used
1 errors, 2 warnings in 38 scripts
```

## Getting started

1. Install [Node.js](https://nodejs.org/) 24 or later.  I like typescript and running in node natively, and 24+ supports type stripping.
2. In the folder with your scripts: `npm install --save-dev @tasermonkey/ic10-lint`.
3. Run `npx ic10-lint`. It checks every `.ic10` file under `ic10/`; give folders or files to check
   others (`npx ic10-lint scripts/airlock.ic10`).

To start with a config, run `npx ic10-lint init`. It writes `ic10-lint.json` with every rule at
its default severity, ready to change. Any script that's already over a game limit gets an
override at its current size, so the first run passes and the script can only shrink from there.

## Current Rules

The rules check the game's limits, that the script loads, batch instructions and `HASH()` names,
and a few style points. See [REFERENCE.md](REFERENCE.md#rules) for each rule.

## The device catalogue

`batch-ops`  (lbn for example) needs to know which logic types each device has. It reads a catalogue: a JSON file with
`prefabs`, each with its `hash`, `logic` (logic type → `"r"`, `"w"` or `"rw"`) and `slots`.
[IC10 Bench](https://github.com/tasermonkey/ic10-bench/tree/main/packages/ic10-bench) writes one
for your project, with your mods' devices, in `.ic10-bench/catalog.json`, and ic10-lint uses it
when it's there. Or pass `--catalog <file>`. `ic10-bench lint` runs ic10-lint with that catalogue
even before you've built it.

Without a catalogue, `batch-ops` is skipped (it says so once), and `hash-name` doesn't know your
mods' prefabs.

## The config: `ic10-lint.json`

Put it in your project's folder to set the scripts folder, rule severities, and overrides for
scripts already over a limit. See [REFERENCE.md](REFERENCE.md#config) for every field.

## Command line

```
ic10-lint [<folder> | <file.ic10> ...] [options]

  --config <file>              the config (default: ic10-lint.json in the current folder)
  --catalog <file>             a device catalogue, for batch-ops and mods' names in hash-name
  --fail-on <error | warning>  exit 1 if anything is at least this bad (default: error)
  --format <text | json>       text: file:line:col severity rule message; json: the findings
  --no-links                   in a terminal, don't make the paths clickable links

ic10-lint init [--dir <folder>] [--config <file>] [--force]

  writes a recommended ic10-lint.json (or --config) for the scripts in --dir (default ic10);
  --force replaces one that's there
```

In a terminal, the text output is in color: the script's path, the severity, and the counts. Each
path is also a link to the file at that line, so Ctrl+click opens it in VS Code and Windows
Terminal even when the path has spaces. `--no-links` keeps the colours and drops the links. Piped
or redirected, the output is plain. `NO_COLOR=1` turns color and links off, and `FORCE_COLOR=1`
turns them on.

In the text output, lines and columns count from 1, as editors do. In the JSON, and in the API,
they count from 0, as the game's `LineNumber` does.

## From code

```ts
import { lint, lintProject, loadConfig } from "@tasermonkey/ic10-lint";

const findings = await lint(source, { catalog }); // [{ rule, severity, line, column, message, text }]
const reports = await lintProject(loadConfig(projectFolder), catalog); // per script, with the config applied
```

## Thanks

The idea of checking the game's limits, the byte-counting method and several of the rules come
from FlorpyDorp's [IC10 language server](https://github.com/FlorpyDorpinator/FlorpyDorp-IC10-Language-Support)
(MIT licence), a VS Code extension worth having if you write IC10. Because I couldn't get the 
CLI in that extension to work, I created this project.  Once I figure more things out, I will
try to figure out how I can just add to the language support project instead. 

## Made with AI

Much of this package, its tests and its documentation was written with Claude, Anthropic's AI
assistant, working under the author's direction. It's part of
[IC10 Bench](https://github.com/tasermonkey/ic10-bench); found something wrong? Please
[open an issue](https://github.com/tasermonkey/ic10-bench/issues).

Working on the linter itself? See [CONTRIBUTING.md](CONTRIBUTING.md).
