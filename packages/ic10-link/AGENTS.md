# Working on ic10-link

Notes for changing the link itself. To use it, see the [README](README.md). Not to be confused
with the IC10Sync mod (C#, in the game), which this works with.

## Layout rules

The package depends on `@tasermonkey/ic10-lint` (to read a script as the game does, and to lint
before sending it, and `runProgram`, the command line's commander set-up all three tools share),
`@inquirer/prompts` (questions in a terminal)
and Node built-ins only. IC10 Bench and Vitest are optional peers, and never
imported from here: `src/sync/gate.ts` loads the *project's* copies (`createRequire` from the project's
`package.json`), so the tests run with the project's versions and config.

Like ic10-lint, it runs from its TypeScript sources in a checkout (the `"source"` export
condition), and from `dist/` once published (`npm run build`, `tsconfig.build.json`). Its tests run
with `npm test` here, or in the repo root's `npm test`.

## Layout

`src/` has a folder per side of the link, one for the sync between them, one for watching and one
for the REPL; `src/index.ts` exports from all of them, and `src/cli.ts` is the command line on
top (`src/io.ts` has `CliIo`, which it and the REPL share): a table of commands, each a function of its arguments, its options and `CliIo`, which
commander parses for, through ic10-lint's `runProgram`. Commander never exits or writes itself, so
the REPL runs each line through `runCli`.

| Folder | What's in it |
| --- | --- |
| `src/game/` | The game's side. `chipdata.ts`: the IC10Sync mod's folder, a subfolder per station, a `<label> [<id>].ic10` file per chip (the mod names the station folder after `XmlSaveLoad.Instance.CurrentStationName`, made safe for a file name). `os.ts`: what depends on the operating system, the Documents folder, read from Windows' registry since OneDrive can move it. |
| `src/project/` | The project's side. `stations.ts`: `stations/<station>.json`, chip ids to scripts. `mapping.ts`: `map`, `adopt` and `unmap`. |
| `src/sync/` | Comparing and copying between the two. `text.ts`, `state.ts`, `gate.ts` (the checks before sending), `defines.ts` (per-chip defines: masked when comparing and hashing, swapped in when sending or pulling), `status.ts` (read only) and `sync.ts` (one pass). |
| `src/watch/` | `watch.ts`: the watchers, which only report changes. `scheduler.ts`: when a pass runs. |
| `src/repl/` | `repl.ts`: `ic10-link repl`. Every line typed goes through one queue. A command's question (a relabelled chip's files) is `io.choose`'s pick list, with the REPL's readline closed while it's open (two readers of the terminal would each get the keys) and opened again after, with its history; lines printed meanwhile are held until then. Without a terminal, the question is asked at the prompt by number. `watch` is `runCli(["watch", …])` left running, with its own `AbortController` for `stop`; output while the prompt waits is printed above it and the prompt redrawn. `words.ts`: splitting a line, quote-aware. |

Text is always compared through `gameText()` (`src/sync/text.ts`), so a chip the game writes back
after loading a file doesn't look like an edit.

A chip can have several files: the mod names the file after the chip's label, and never deletes
the old one when the label changes. Only the player knows which is current, so `stationStatus`
reports them as `duplicates` and treats the chip as unknown until one is left.

## Passes

`src/sync/sync.ts` is one pass; `src/watch/watch.ts` runs passes on file changes. Its watchers only
report that something changed; `src/watch/scheduler.ts` decides when a pass runs (once changes
settle, one at a time, once more if something changed during one). A pass compares each chip and
its script with the hash of what they last both had (`src/sync/state.ts`), to
tell which side changed. A `Session` carries the checks already done and what was last said about
each chip between passes, so `watch` doesn't check or print the same thing twice.

## Tests

`test/` has the same folders as `src/` (`test/sync/sync.test.ts` tests `src/sync/sync.ts`);
the command line's tests, `map`/`adopt`/`unmap`'s among them, are in `test/cli.test.ts`. Tests
build a project and a chipdata folder in temp folders (`test/project.ts`). Nothing reads the
real registry, game folder or terminal: `CliIo.documents`, `env` and `choose` stand in for them
(`choose` is @inquirer/prompts' `select` in `bin/ic10-link.ts`, the only place that imports it).
`findTests` and `runTests` stand in for the project's IC10 Bench and Vitest; lint runs for real.
