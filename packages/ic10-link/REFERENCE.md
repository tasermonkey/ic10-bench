# ic10-link reference

## Commands

| Command | What it does |
| --- | --- |
| `ic10-link status` | Lists the station's chips: the mapped ones and how each compares with its script, the unmapped ones with code, and the empty ones. It changes nothing, except for deleting a relabelled chip's old files when you say which one is current (see [Relabelled chips](#relabelled-chips)). |
| `ic10-link map <chip id> <script.ic10>` | Maps the chip to a script the project has, replacing what it was mapped to. The game needn't have a file for the chip yet. |
| `ic10-link adopt <chip id> <script.ic10>` | Copies the chip's code from the game into a new script (as the game keeps it, with LF line endings), and maps the chip to it. Won't overwrite a script, or pick between a relabelled chip's files. |
| `ic10-link unmap <chip id>` | Takes the chip out of the map. Its script stays. |
| `ic10-link once` | One pass: each mapped chip whose script changed gets the script, if it passes its [checks](#checks-before-sending), and each chip edited in game is copied back to its script. See [Passes](#passes). |
| `ic10-link watch` | A pass at the start, then another whenever a script, a test, a station's map or a chip's file changes, until Ctrl+C. Each line it prints starts with the time, to match against the game's console. |

A chip id is the number in brackets in the chip's file name, with or without the brackets: `450`
or `[450]` for `Script1 [450].ic10`. Script paths are relative to where you run the command, which
is the project's folder.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `--chipdata <folder>` | `IC10_CHIPDATA`, else `<Documents>\My Games\Stationeers\chipdata` | The IC10Sync mod's folder. The Documents folder is read from Windows' registry, so it's found even when OneDrive has moved it. |
| `--station <name>` | The station played most recently | Which of the chipdata folder's stations to use. |
| `--no-tests` | | `once` and `watch`: check lint only, without running tests. |
| `--help` | | The usage: `ic10-link --help` lists the commands, `ic10-link <command> --help` gives a command's options. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done. |
| 1 | `status`: a chip still has several files (see [Relabelled chips](#relabelled-chips)). `once`: a script failed its checks, whether it was held back or copied from the game. |
| 2 | A bad command, argument or option, no chipdata folder or station, or a `map`, `adopt` or `unmap` that couldn't be done (the message says why). |

## Mapped chip states

| State | Meaning |
| --- | --- |
| `same` | The chip runs the script as it is (compared as the game reads them: trailing spaces, tabs and line endings don't count). |
| `differs` | The chip's code and the script differ. |
| `no script` | The map names a script the project doesn't have. |
| `not in game` | The game hasn't written the chip's file: the station isn't loaded yet, or the chip is gone. |
| `several files` | The chip was relabelled, so it has more than one file (see [Relabelled chips](#relabelled-chips)). |

## Passes

Each mapped chip's code and its script are compared with what they last both had, kept in
`.ic10-link/state.json` in the project (don't commit it).

| What changed since | What a pass does |
| --- | --- |
| Nothing | Nothing. |
| The script | [Checks](#checks-before-sending) it, then writes it to the chip's file. The IC10Sync mod loads it into the chip within about 10 seconds. If the checks fail, the chip keeps its code. |
| The chip (edited in game) | Writes the chip's code to the script (LF line endings), so it shows up as a change in git, then [checks](#checks-before-sending) it and says how that went. A failure is only reported: the code is already running in game. A chip emptied in game isn't copied. |
| Both | The script wins: it's checked and sent as above. The chip's code is kept in `.ic10-link/preserved/<station>/conflicts/` first, to copy back from by hand. |
| No record yet (newly mapped) | Treated as a changed script: mapping the chip said it should run it. The chip's code before is kept in `.ic10-link/preserved/<station>/backups/`. |

Everything kept this way is under `.ic10-link/preserved/`, and nothing reads it back, so deleting that
folder is always safe. `.ic10-link/state.json` is the record passes compare against; deleting it
makes every mapped chip count as newly mapped on the next pass.

A chip that has no file, several files or no script is skipped, with a line saying why. In `watch`,
nothing is said twice about a chip until something changes.

## Checks before sending

| Check | Fails on | Skipped when |
| --- | --- | --- |
| Lint | An `error` from [ic10-lint](../ic10-lint/REFERENCE.md), with the project's `ic10-lint.json` and IC10 Bench's catalogue if it's built. Turn a rule down for one script with an override there. | Never. |
| Tests | Any failure in the test files that name the script (their text has its file name), run with the project's Vitest and config. | `--no-tests`, or no test names the script. The line saying it was sent says which. |

A script is checked once per change, however many chips run it. In `watch`, changing a test file
checks again.

## Relabelled chips

The IC10Sync mod names a chip's file after its label, so relabelling the chip in game starts a new
file and leaves the old one. The mod only reads the file with the chip's label now, and only you
know which that is.

| Where `status` runs | What happens |
| --- | --- |
| A terminal | For each chip with several files, it lists them (when each changed, how many lines) and asks which is current. The others are deleted. Enter skips the chip. |
| A pipe, CI, a script | It lists them and exits 1. |

## `stations/<station>.json`

| Field | What it holds |
| --- | --- |
| `chips` | Chip id → the chip's entry. Keyed by id, so relabelling a chip in game doesn't lose it. |

A chip's entry:

| Field | What it holds |
| --- | --- |
| `script` | The script the chip runs, relative to the project, with forward slashes. |

A chip whose entry has only `script` can be written as just the path, and `map` and `adopt` save it
that way:

```json
{
	"chips": {
		"450": "ic10/Misc/Sync Demo.ic10",
		"451": { "script": "ic10/Tests/Sync Demo Counter.ic10" }
	}
}
```

To have the project's tests catch a mapped script that was renamed or moved, call
`checkStations(root)`: it returns each chip, in every station's map, whose script the project
doesn't have, and throws for a map that doesn't load.

```ts
import { checkStations } from "@tasermonkey/ic10-link";

it("maps chips only to scripts that exist", () => {
	expect(checkStations(REPO_ROOT)).toEqual([]);
});
```
