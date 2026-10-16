/**
 * `defineIc10Config`: Vitest's `defineConfig` with ic10-bench set up, for a project's
 * vitest.config.ts:
 *
 * ```ts
 * import { defineIc10Config } from "@tasermonkey/ic10-bench/config";
 * export default defineIc10Config();
 * ```
 *
 * It adds the IC10 matchers (`toHaveProps`, `toHaveRegister`, …) as a setup file, and tells the
 * harness where the project is (IC10_BENCH_ROOT), so it finds ic10-mods/ and the catalogue
 * `ic10-bench catalog` builds. In watch mode, a changed `.ic10` file reruns the tests that name
 * it. Anything you pass is merged in, as with Vitest's `mergeConfig`.
 */
import { globSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig, type ViteUserConfig } from "vitest/config";
import { ROOT_ENV } from "./project.ts";

/** The matchers' setup file, beside this one (.ts in a checkout, .js once built). */
const SETUP_FILE = fileURLToPath(new URL(`./matchers/vitest-setup${extname(fileURLToPath(import.meta.url))}`, import.meta.url));

/** Vitest's own defaults for `test.include` and `test.exclude`. */
const DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/.git/**"];

export interface Ic10ConfigOptions {
	/** The project's folder, with its ic10-mods/ and .ic10-bench/. Default: the config's `root`, else the working directory. */
	project?: string;
	/** In watch mode, rerun the tests that name a `.ic10` file when it changes. Default: true. */
	watchScripts?: boolean;
}

export function defineIc10Config(config: ViteUserConfig = {}, options: Ic10ConfigOptions = {}): ViteUserConfig {
	const project = resolve(options.project ?? config.root ?? process.cwd());
	const watch = options.watchScripts === false ? {} : { watchTriggerPatterns: [{ pattern: /\.ic10$/i, testsToRun: testsNaming(config) }] };
	return mergeConfig({ test: { setupFiles: [SETUP_FILE], env: { [ROOT_ENV]: project }, ...watch } }, config);
}

/**
 * The test files (by the config's `include` and `exclude`) whose text has a script's file name.
 * Tests give a script as a path, so its name is what they all have in common, however the path
 * is built or whatever it's relative to. Two scripts with the same name rerun each other's tests.
 */
function testsNaming(config: ViteUserConfig): (file: string) => string[] {
	const root = resolve(config.root ?? process.cwd());
	return (file) => {
		const name = basename(file);
		const tests = globSync(config.test?.include ?? DEFAULT_INCLUDE, { cwd: root, exclude: config.test?.exclude ?? DEFAULT_EXCLUDE });
		return tests.map((test) => resolve(root, test)).filter((test) => readFileSync(test, "utf8").includes(name));
	};
}
