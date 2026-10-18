/**
 * Which test files are a script's: the ones whose text has the script's file name. Tests give a
 * script as a path, so its name is what they all have in common, however the path is built or
 * whatever it's relative to. Two scripts with the same name share each other's tests.
 *
 * Used by `defineIc10Config` (watch mode reruns them when the script changes) and by ic10-link
 * (runs them before it sends a script to the game). It doesn't import Vitest, so the latter can
 * use it without loading Vitest.
 */
import { globSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

/** Vitest's own defaults for `test.include` and `test.exclude`. */
export const DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];
export const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/.git/**"];

/** The test files under `root` (absolute paths) whose text has `script`'s file name. */
export function testsNamingScript(root: string, script: string, include: string[] = DEFAULT_INCLUDE, exclude: string[] = DEFAULT_EXCLUDE): string[] {
	const name = basename(script);
	return globSync(include, { cwd: root, exclude })
		.map((test) => resolve(root, test))
		.filter((test) => readFileSync(test, "utf8").includes(name));
}
