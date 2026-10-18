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
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig, type ViteUserConfig } from "vitest/config";
import { ROOT_ENV } from "./project.ts";
import { testsNamingScript } from "./related-tests.ts";

/** The matchers' setup file, beside this one (.ts in a checkout, .js once built). */
const SETUP_FILE = fileURLToPath(new URL(`./matchers/vitest-setup${extname(fileURLToPath(import.meta.url))}`, import.meta.url));

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

/** The test files (by the config's `include` and `exclude`) that name a script (see `testsNamingScript`). */
function testsNaming(config: ViteUserConfig): (file: string) => string[] {
	const root = resolve(config.root ?? process.cwd());
	return (file) => testsNamingScript(root, file, config.test?.include, config.test?.exclude);
}
