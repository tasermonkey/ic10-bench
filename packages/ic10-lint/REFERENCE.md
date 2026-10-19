# @tasermonkey/ic10-lint reference

What each rule checks, and the config file. For how to install and run the linter, see the
[README](README.md).

## Rules

Change a rule's severity to `"error"`, `"warn"`, `"info"` or `"off"` in the [config](#config), for
every script or for one.

| Rule | Default | What it checks |
|---|---|---|
| `max-lines` | error | No more than 128 lines. Comment and blank lines count: they're lines in the game too. Only a warning if just comments and blank lines are past line 128. |
| `max-columns` | error | No line past 90 characters. Only a warning when it's a comment that goes past (the game cuts the comment short, which is harmless). |
| `max-bytes` | error | No more than 4096 characters, counted the way the game does. It points at the line where the count passes 4096. |
| `validate` | error | The script loads in the emulator: syntax, argument counts, aliases, defines and labels that don't exist (aliases are case sensitive). |
| `batch-ops` | error | `lb`, `lbn`, `lbs`, `lbns`, `sb`, `sbn` and `sbs` use logic types their prefab has, with the right Read/Write, and name a prefab that exists. Needs a [device catalogue](README.md#the-device-catalogue). |
| `hash-name` | error / warning | `HASH("5")`, which hashes the text "5", not the number, is an error. `HASH("StructureActivVent")`, a name shaped like a prefab that the game doesn't have, is a warning. |
| `relative-branch-to-label` | warning | `brgt r0 r1 loop`: the `br*` branches and `jr` take an offset, so this jumps by the label's line number, not to it. |
| `absolute-jump-number` | warning | `j 12` or `beqz r0 12`: the line moves when you add a line above it. Use a label. (`j 0` is fine.) |
| `per-chip-block` | error | A [per-chip block](#per-chip-blocks) ic10-link can't find: a `link-per-chip {` without its `}` (or the other way), one inside another, a marker on a line with no code, or a `<script>.json` that's bad or names a block the script doesn't have. |
| `per-chip-jump` | warning | In a script with a [per-chip block](#per-chip-blocks): `j 12` past the block's start, or `brgtz r0 5` over it. Each chip has its own number of lines in the block, so the line is a different one on each. Use a label. |
| `unused` | warning | An alias, define or label nothing uses. |
| `register-flow` | off | A register read before anything writes it, or written and never read. Off by default: registers start at 0 (and keep their values across a restart), so a script can rely on that. |

## Config

`ic10-lint.json`, in your project's folder. Every part is optional. `npx ic10-lint init` writes one
with every rule at its default severity.

```json
{
  "$schema": "./node_modules/@tasermonkey/ic10-lint/schema.json",
  "dir": "ic10",
  "rules": { "unused": "off", "register-flow": "info" },
  "overrides": {
    "ic10/Battery Controller.ic10": {
      "reason": "over the limits in the save; trim it later",
      "limits": { "lines": 162, "bytes": 5135 }
    },
    "ic10/Debug.ic10": { "reason": "a debug chip", "rules": { "unused": "off" } },
    "ic10/Audit/**": { "reason": "checks the game's errors, so fails on purpose", "rules": { "validate": "off", "idle": "off" } }
  }
}
```

| Field | Default | What it does |
|---|---|---|
| `dir` | `ic10` | The folder of scripts to check when you don't name any, subfolders included (but not `node_modules` or folders starting with `.`). |
| `rules` | each rule's default | A severity for any rule: `"error"`, `"warn"`, `"info"` or `"off"`. |
| `overrides` | none | Settings for one script, by its path from the project's folder, with `/`, or for every script a pattern matches. See below. |

### Overrides

| Field | What it does |
|---|---|
| `reason` | Required. Why the script is different. |
| `limits` | Lets a script that's already over a limit (`lines`, `columns` or `bytes`) stay that size, but not grow. |
| `rules` | Severities for this script only. |

Past the number in `limits`, it's an error again. Shrink the script and you're told to lower the
number; get it under the game's limit and you're told to remove the override. An override for a
script that's gone is an error too, so they don't pile up.

A key with a `*` is a pattern: `*` matches within a folder, `**` across folders, so
`ic10/Audit/**` is every script under `ic10/Audit/`. Only a `*` makes a key a pattern, so a script
named with brackets, like `ic10/Air [7335].ic10`, is still just that script. A pattern sets `rules`
only, since `limits` are one script's allowance. A script takes the rules of every pattern that
matches it, in the file's order, then its own entry's, each over the ones before. A pattern that
matches no script is an error, like an override for a script that's gone.

The config is a file and not comments in the scripts, because a comment costs a script lines and
characters. IC10 Bench reads the same file (its `idle` check takes a severity here too).

## Per-chip blocks

[ic10-link](../ic10-link/REFERENCE.md#per-chip-blocks) sends a script to every chip that runs it,
but some lines are each chip's: a list of names a script pushes to its stack, say, which is a
different length on each chip. A block marks them, between two lines of code whose comments start
`link-per-chip {` and `link-per-chip }`:

```
push 0 # link-per-chip {
push HASH("StructureLightLong")
push HASH("StructureWallLight")
poke 0 sp # link-per-chip } the list's top
```

Or, for a script that shouldn't carry the markers, in `<script>.json` beside it (`Room
Lights.ic10.json`), by the two lines' code:

```json
{ "perChip": { "byBlock": [{ "from": "push 0", "to": "poke 0 sp" }] } }
```

Lint reads both: `per-chip-block` checks that ic10-link can find each block, and `per-chip-jump`
warns about jumping to a line number past one.
