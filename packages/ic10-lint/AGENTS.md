# Working on ic10-lint

Notes for changing the linter itself. To use it on your own scripts, see the [README](README.md).

## Layout rules

The package depends on `@tasermonkey/ic10` (the emulator fork, for `validate`, the number parsers
and the game's prefab names) and Node built-ins only. It must not import IC10 Bench: IC10 Bench
depends on it, and passes it its catalogue as data.

Like IC10 Bench, it runs from its TypeScript sources in a checkout (the `"source"` export
condition), and from `dist/` once published (`npm run build`, `tsconfig.build.json`, with
`stripInternal`). Its tests run with `npm test` here, or in the repo root's `npm test`.

## How a script is read

`src/source.ts` reads a script once, the way the game's editor does when you paste it (trailing
whitespace dropped, tabs to spaces, non-ASCII dropped, trailing blank lines dropped), into lines
with their code, where the comment starts, their tokens (`HASH("…")` and `STR("…")` whole) and
each token's column, plus the script's defines, aliases and labels. Every rule works from that, so
they agree with each other and with the game. `src/limits.ts` has the game's limits and its way of
counting the size.

Numbers go through `parseLiteral` (`src/numbers.ts`), which is the fork's own parsers in order, so
`$hex`, `%bin`, exponents and constants read as the emulator reads them. IC10 Bench's debugger uses
it too.

## Adding a rule

1. Add `src/rules/<id>.ts` exporting a `Rule`:
   ```ts
   export const myRule: Rule = {
     id: "my-rule",
     defaultSeverity: "warning",
     description: "One line, for --help and the README's table",
     check({ script, catalog, report }) {
       for (const line of script.lines) {
         if (/* … */) report({ line: line.index, column: line.columns[0]!, message: "what's wrong, and what to do" });
       }
     },
   };
   ```
   `check` may be async. `report` uses the rule's severity unless the finding gives its own (as
   `max-columns` does for comments). Set `needsCatalog` if it can't run without the device
   catalogue (`lint` then reports once that it was skipped), or `defaultOff` if it's too noisy to
   be on by default.
2. Add it to `RULES` in `src/rules/index.ts`, in the order its findings should list.
3. Add `test/<id>.test.ts` with small inline scripts: what it reports (line, severity, message) and
   what it leaves alone. For a limit, test the boundary (exactly at the limit, one past it), CRLF
   input, and trailing whitespace and blank lines.
4. Add a row to the README's table, and to IC10 Bench's `CHECK_GROUPS` (`src/checks.ts`) so its
   per-script tests run it.

A limit rule takes an override from the config (`context.override`): `allowance()` reports an
override that's stale or bigger than needed, and `overLimit()` turns a finding within it into info.

## Overrides and the config

`src/config.ts` reads and checks `ic10-lint.json` (bad severities, a missing `reason`, a limit at
or under the game's are errors, with the file's name). `lintFile` applies the project's rules, then
the script's override. `lintProject` also reports overrides for scripts that aren't there.

## The CLI

`bin/ic10-lint.ts` calls `runCli` (`src/cli.ts`), which takes the arguments and an `out` function
and returns the exit code (0 clean, 1 findings at or above `--fail-on`, 2 a bad option or config),
so it's tested without a child process. `ic10-bench lint` calls the same function with the
project's catalogue.

`init` is handled first, with its own options. `src/init.ts` builds the config from `RULES` (each
rule's default severity, `"off"` for `defaultOff`) and measures each script the way the limit rules
do. That's the line count, the longest line of code, and `gameSize`. It writes an override only
for a limit that would be an error: comment-only lines past 128 are just a warning, so they get
none. If a rule's measure changes, change `overLimits()` to match, or `init` writes overrides the
rule then calls wrong.

A configured severity takes the place of the rule's default (`severityOf()` in `src/lint.ts`). A
finding the rule made milder, like a cut comment or an override's info, stays that mild, so a
config that names a rule's default (as `init`'s does) changes nothing.

`schema.json` describes the config for editors, and `init` points `$schema` at it. It's written by
hand. `test/schema.test.ts` fails if it falls out of step with `RULES` (ids and defaults),
`GAME_LIMITS` or the severities, so a new rule needs an entry there.
