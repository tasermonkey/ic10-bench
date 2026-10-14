# @tasermonkey/ic10-lint

Checks your Stationeers IC10 scripts without running them: that they fit in the chip editor (128
lines, 90 characters a line, 4096 characters), that they load, that batch instructions use logic
types their devices have, and a few common mistakes. Use it from the command line, in CI or a
pre-commit hook, or from your tests through
[IC10 Bench](https://github.com/tasermonkey/ic10-bench/tree/main/packages/ic10-bench#checking-every-script).

```
$ npx ic10-lint
ic10/Big Script.ic10:129:1 error max-lines 162 lines; the game keeps 128, so lines 129 to 162 are lost (31 lines of code)
ic10/Air.ic10:11:91 warning max-columns 128 characters; the game cuts the line at 90, losing the end of the comment
ic10/Lights.ic10:2:7 warning unused alias Sensor2 is never used
1 errors, 2 warnings in 38 scripts
```

## Getting started

1. Install [Node.js](https://nodejs.org/) 24 or later.
2. In the folder with your scripts: `npm install --save-dev @tasermonkey/ic10-lint`.
3. Run `npx ic10-lint`. It checks every `.ic10` file under `ic10/`; give folders or files to check
   others (`npx ic10-lint scripts/airlock.ic10`).

It exits with 1 when it finds an error (or, with `--fail-on warning`, a warning), so a CI step or a
pre-commit hook can run it as it is.

To start with a config, run `npx ic10-lint init`. It writes `ic10-lint.json` with every rule at
its default severity, ready to change. Any script that's already over a game limit gets an
override at its current size, so the first run passes and the script can only shrink from there.

## What it checks

| Rule | Default | What it checks |
|---|---|---|
| `max-lines` | error | No more than 128 lines. Comment and blank lines count: they're lines in the game too. Only a warning if just comments and blank lines are past line 128. |
| `max-columns` | error | No line past 90 characters. Only a warning when it's a comment that goes past (the game cuts the comment short, which is harmless). |
| `max-bytes` | error | No more than 4096 characters, counted the way the game does (below). It points at the line where the count passes 4096. |
| `validate` | error | The script loads in the emulator: syntax, argument counts, aliases, defines and labels that don't exist (aliases are case sensitive). |
| `batch-ops` | error | `lb`, `lbn`, `lbs`, `lbns`, `sb`, `sbn` and `sbs` use logic types their prefab has, with the right Read/Write, and name a prefab that exists. Needs a device catalogue (below). |
| `hash-name` | error / warning | `HASH("5")`, which hashes the text "5", not the number, is an error. `HASH("StructureActivVent")`, a name shaped like a prefab that the game doesn't have, is a warning. |
| `relative-branch-to-label` | warning | `brgt r0 r1 loop`: the `br*` branches and `jr` take an offset, so this jumps by the label's line number, not to it. |
| `absolute-jump-number` | warning | `j 12` or `beqz r0 12`: the line moves when you add a line above it. Use a label. (`j 0` is fine.) |
| `unused` | warning | An alias, define or label nothing uses. |
| `register-flow` | off | A register read before anything writes it, or written and never read. Off by default: registers start at 0 (and keep their values across a restart), so a script can rely on that. |

**How the game counts.** These come from the game's chip editor code (`InputSourceCode`). When you
paste a script, the game drops trailing spaces from the end of the script and of each line, turns
tabs into spaces, drops any character outside ASCII, and keeps the first 90 characters of each of
the first 128 lines. Its size is each line's length plus 2 for every line break (it counts them as
CRLF), up to the last line that isn't blank. Past 4096 the editor won't let you submit the script.
ic10-lint counts the same way, so a script it passes fits in the game.

## The device catalogue

`batch-ops` needs to know which logic types each device has. It reads a catalogue: a JSON file with
`prefabs`, each with its `hash`, `logic` (logic type → `"r"`, `"w"` or `"rw"`) and `slots`.
[IC10 Bench](https://github.com/tasermonkey/ic10-bench/tree/main/packages/ic10-bench) writes one
for your project, with your mods' devices, in `.ic10-bench/catalog.json`, and ic10-lint uses it
when it's there. Or pass `--catalog <file>`. `ic10-bench lint` runs ic10-lint with that catalogue
even before you've built it.

Without a catalogue, `batch-ops` is skipped (it says so once), and `hash-name` doesn't know your
mods' prefabs.

## The config: `ic10-lint.json`

Put it in your project's folder. Every part is optional.

```json
{
  "dir": "ic10",
  "rules": { "unused": "off", "register-flow": "info" },
  "overrides": {
    "ic10/Battery Controller.ic10": {
      "reason": "over the limits in the save; trim it later",
      "limits": { "lines": 162, "bytes": 5135 }
    },
    "ic10/Debug.ic10": { "reason": "a debug chip", "rules": { "unused": "off" } }
  }
}
```

- `dir`: the folder of scripts to check when you don't name any. Default `ic10`.
- `rules`: a severity for any rule: `"error"`, `"warn"`, `"info"` or `"off"`.
- `overrides`: by script path (from the project's folder, with `/`). Each needs a `reason`.
  - `limits` lets a script that's already over a limit (`lines`, `columns` or `bytes`) stay that
    size, but not grow: past the number you give, it's an error again. Shrink the script and
    you're told to lower the number; get it under the game's limit and you're told to remove the
    override. An override for a script that's gone is an error too, so they don't pile up.
  - `rules` changes severities for that script only.

For completion and checks as you edit it (in VS Code and other editors that read JSON schemas), add
`"$schema": "./node_modules/@tasermonkey/ic10-lint/schema.json"`. `init` adds it for you.

It's a file and not comments in the scripts, because a comment costs a script lines and characters.
IC10 Bench reads the same file (its `idle` check takes a severity here too).

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

In a terminal, the text output is in colour: the script's path, the severity, and the counts. Each
path is also a link to the file at that line, so Ctrl+click opens it in VS Code and Windows
Terminal even when the path has spaces. `--no-links` keeps the colours and drops the links. Piped
or redirected, the output is plain. `NO_COLOR=1` turns colour and links off, and `FORCE_COLOR=1`
turns them on.

In the text output, lines and columns count from 1, as editors do. In the JSON, and in the API,
they count from 0, as the game's `LineNumber` does.

## From code

```ts
import { lint, lintProject, loadConfig } from "@tasermonkey/ic10-lint";

const findings = await lint(source, { catalog }); // [{ rule, severity, line, column, message, text }]
const reports = await lintProject(loadConfig(projectFolder), catalog); // per script, with the config applied
```

Also exported: `initConfig` and `recommendedConfig` (what `init` writes), `lintFiles`, `checkBatchOps` (just the batch-instruction check), `gameSize` (a
script's size the game's way), `GAME_LIMITS`, `parseLiteral` (a number literal as the emulator
reads it) and `RULES`.

## Thanks

The idea of checking the game's limits, the byte-counting method and several of the rules come
from FlorpyDorp's [IC10 language server](https://github.com/FlorpyDorpinator/FlorpyDorp-IC10-Language-Support)
(MIT licence), a VS Code extension worth having if you write IC10. ic10-lint is its own code, with
no dependency on it; the counting was checked against the game's own code.

## Made with AI

Much of this package, its tests and its documentation was written with Claude, Anthropic's AI
assistant, working under the author's direction. It's part of
[IC10 Bench](https://github.com/tasermonkey/ic10-bench); found something wrong? Please
[open an issue](https://github.com/tasermonkey/ic10-bench/issues).

Working on the linter itself? See [CONTRIBUTING.md](CONTRIBUTING.md).
