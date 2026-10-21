# ic10-link reference

## Commands

| Command | What it does |
| --- | --- |
| `ic10-link status` | Lists the station's chips: the mapped ones and how each compares with its script, the unmapped ones with code, and the empty ones. It changes nothing, except for deleting a relabelled chip's old files when you say which one is current (see [Relabelled chips](#relabelled-chips)). |
| `ic10-link map <chip id> <script.ic10>` | Maps the chip to a script the project has, replacing what it was mapped to. The game needn't have a file for the chip yet. |
| `ic10-link adopt <chip id> <script.ic10>` | Copies the chip's code from the game into a new script (as the game keeps it, with LF line endings), and maps the chip to it. Won't overwrite a script, or pick between a relabelled chip's files. |
| `ic10-link auto-map` | Maps each chip that's empty and not mapped yet to the script named like its label: a chip labelled `Room Lights` runs `ic10/EControl/Room Lights.ic10`. The scripts are the ones in `ic10-lint.json`'s `dir` (`ic10` by default), and a name matches without `.ic10`, ignoring case. Lists the chips it mapped, and the ones whose label names several scripts, which it leaves for `map`. A chip with code is left alone (see `adopt`), and so is a [relabelled chip](#relabelled-chips) until `status` has picked its file. |
| `ic10-link unmap <chip id>` | Takes the chip out of the map. Its script stays. |
| `ic10-link once` | One pass: each mapped chip whose script changed gets the script, if it passes its [checks](#checks-before-sending), and each chip edited in game is copied back to its script. See [Passes](#passes). |
| `ic10-link watch` | A pass at the start, then another whenever a script, a test, a station's map or a chip's file changes, until Ctrl+C. Each line it prints starts with the time, to match against the game's console. |
| `ic10-link per-chip <script.ic10> [name...] [--from <code> --to <code>]` | Makes the script's defines with those names [per-chip](#per-chip-defines), and the lines between `--from` and `--to` a [per-chip block](#per-chip-blocks), listed in `<script>.ic10.json` beside it: makes the file if there's none, keeps what else it has, and skips what's already per-chip. A name the script doesn't define yet is added, with a note; a block the script doesn't have isn't. Takes no `--chipdata` or `--station`. |
| `ic10-link repl` | A prompt to run the commands one after another, without typing `ic10-link`. See [The REPL](#the-repl). |

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
| 2 | A bad command, argument or option, no chipdata folder or station, or a `map`, `adopt`, `auto-map` or `unmap` that couldn't be done (the message says why). |

## Mapped chip states

| State | Meaning |
| --- | --- |
| `same` | The chip runs the script as it is (compared as the game reads them: trailing spaces, tabs and line endings don't count), but for the values of its [per-chip defines](#per-chip-defines) and the lines of its [per-chip blocks](#per-chip-blocks), which `status` shows after the state. |
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

## Per-chip defines

A script can say that some of its `define`s belong to each chip that runs it, such as the room a
lights chip looks after. Their values then don't count as a change either way: a chip keeps its own
value when it's sent the script, and the script keeps its own when it's sent a chip's edit, so one
chip's value never becomes every chip's. A chip that differs from its script only in those values
is `same`.

The script says so itself, once for every chip and every station, in either of two ways:

| Way | Looks like |
| --- | --- |
| A comment starting `link-per-chip` on the define's line. Anything after it is a note. | `define ROOM_LIGHT HASH("Room Light") # link-per-chip` |
| `<script>.json` beside the script, naming them; `ic10-link per-chip <script> <name...>` writes it. | `Room Lights.ic10.json`: `{ "perChip": { "byDefineName": ["ROOM_LIGHT"] } }` |

| Pass | With per-chip defines |
| --- | --- |
| Sending the script | Each per-chip define gets the chip's current value. A chip that doesn't have the define yet gets the script's. |
| Copying a chip's edit to the script | Each per-chip define keeps the script's value. |
| A chip whose only change in game is a per-chip value | Nothing: that's not an edit. |

The names are read from the script in the project, never from the chip, so deleting a marker in
game changes nothing. A `.json` that isn't as above skips the chip, with the file's name, and is a
lint error (`per-chip-block`). A name in it that the script doesn't define shows in `status` as `not
in the script`. `checkPerChipFiles(root)` lists the `.ic10.json` files whose script is gone, for a
project's tests, beside `checkStations`.

## Per-chip blocks

A block is lines that belong to each chip, however many each has: a list of names a script pushes
to its stack, say, one list per room. It's the lines between two lines of code, its anchors, which
are the script's:

| Way | Looks like |
| --- | --- |
| Comments starting `link-per-chip {` and `link-per-chip }` on the anchors. Anything after is a note. | `push 0 # link-per-chip {` … `poke 0 sp # link-per-chip }` |
| `<script>.json`, by the anchors' code; `ic10-link per-chip <script> --from <code> --to <code>` writes it. | `{ "perChip": { "byBlock": [{ "from": "push 0", "to": "poke 0 sp" }] } }` |

A block is found in a text by its markers, or else by its anchors' code: the first line with the
start's code, then the first after it with the end's. So a chip that has the list but not the
markers yet is found too, and adding the markers to a script doesn't count as a change.

| Pass | With per-chip blocks |
| --- | --- |
| Comparing | Each block's lines don't count, nor the markers. A chip whose list differs, in length too, is `same`; `status` shows how many lines it has. |
| Sending the script | Each block gets the chip's lines. A chip without the block (empty, or running something else) gets the script's; if it had code, that's kept in `backups/` first. |
| The game's limits | What each chip is sent is checked against them (with the script's override, if it has one): a chip whose own lines take it over isn't sent. Per-chip defines' values count too. |
| Copying a chip's edit to the script | Each block keeps the script's lines. A chip whose anchor was edited away isn't copied, since its own lines can't be told from the rest: it's kept in `conflicts/`, and `once` exits 1. |

Every line after a block's start is a different line on each chip, so jump to labels, not line
numbers: ic10-lint's `per-chip-jump` warns about one, and `per-chip-block` about a block it can't
find (a marker without its pair, or on a line with no code).

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
| A terminal | For each chip with several files, it asks which is current, from a list of them (when each changed, how many lines); pick one with the arrow keys and Enter. The others are deleted. "Skip" keeps them all; Ctrl+C stops, deleting nothing more. |
| A pipe, CI, a script | It lists them and exits 1. |

## The REPL

`ic10-link repl` takes `--chipdata` and `--station`, and every command run in it uses them unless
it gives its own. Quote a word with spaces: `map 450 "ic10/Tests/Sync Demo.ic10"`. Backslashes are
kept as they are, for Windows' paths. Tab completes a command's name.

| Typed | What it does |
| --- | --- |
| A command | Runs it, as `ic10-link <command>` would. |
| `watch` | Starts watching in the background, and comes back to the prompt: its lines print above the prompt, which reads `ic10-link (watching)>`. `map`, `adopt` and `unmap` can run beside it, and it picks up their changes. `once` can't, since two passes at once would race. |
| `stop` | Stops watching, after the pass it's in. |
| `help` | Lists the commands. |
| `exit`, `quit`, Ctrl+D | Leaves, stopping a watch first. Ctrl+C only drops what's typed. |

A relabelled chip's question (see [Relabelled chips](#relabelled-chips)) is the same list as on the
command line, picked with the arrow keys; the prompt comes back once it's answered, and a background
watch's lines wait until then. With the REPL's input from a pipe rather than a terminal, it's asked
at the prompt with the files numbered: the number is the answer.

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
