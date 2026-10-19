/**
 * The checks a script passes before it's sent to the game: no lint errors, and its tests pass.
 * Its tests are the project's test files that name it (IC10 Bench's `testsNamingScript`), run
 * with the project's own Vitest and config.
 */
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { lint, lintFile, loadConfig, overrideFor, projectCatalog, RULES } from "@tasermonkey/ic10-lint";

export interface TestRun {
	ok: boolean;
	/** What Vitest printed. */
	output: string;
}

export interface GateOptions {
	/** The project. */
	root: string;
	/** Run the script's tests (default true); false checks lint only. */
	tests?: boolean;
	/** The script's test files. Default: the project's IC10 Bench. */
	findTests?: (root: string, script: string) => Promise<string[]>;
	/** Runs test files. Default: the project's Vitest. */
	runTests?: (root: string, files: string[]) => Promise<TestRun>;
}

export interface GateResult {
	ok: boolean;
	/** What to tell the player, a line each: the lint errors, the tests run, or why they weren't. */
	report: string[];
}

/** The most of Vitest's output shown for failing tests. */
const OUTPUT_LINES = 80;

function projectRequire(root: string): NodeJS.Require {
	return createRequire(join(root, "package.json"));
}

/** The script's test files, by the project's IC10 Bench's `testsNamingScript`. */
export async function projectTests(root: string, script: string): Promise<string[]> {
	const module: { testsNamingScript(root: string, script: string): string[] } = await import(
		pathToFileURL(projectRequire(root).resolve("@tasermonkey/ic10-bench/related-tests")).href
	);
	return module.testsNamingScript(root, script);
}

/** Runs test files with the project's Vitest, as `vitest run <files>` would. */
export function projectVitest(root: string, files: string[]): Promise<TestRun> {
	const vitest = join(dirname(projectRequire(root).resolve("vitest/package.json")), "vitest.mjs");
	// Vitest takes the paths as filters on the files its config includes; relative, with forward slashes.
	const filters = files.map((file) => relative(root, file).replaceAll("\\", "/"));
	return new Promise((resolve) => {
		execFile(process.execPath, [vitest, "run", ...filters], { cwd: root, env: { ...process.env, FORCE_COLOR: "0" } }, (error, stdout, stderr) => {
			resolve({ ok: !error, output: `${stdout}${stderr}` });
		});
	});
}

/** Lint's checks of the game's limits. */
const LIMIT_RULES = ["max-lines", "max-columns", "max-bytes"];

/**
 * The game's limits on the text a chip is sent, as lint checks them, with the project's severities
 * and the script's override (`script` is its path in the project): what's over, a line each. The
 * script passed them, but a chip's own per-chip values and lines can take it over.
 */
export async function overLimits(root: string, script: string, text: string): Promise<string[]> {
	const config = loadConfig(root);
	const override = overrideFor(config, script);
	const others = RULES.filter((rule) => !LIMIT_RULES.includes(rule.id)).map((rule) => [rule.id, "off"] as const);
	const findings = await lint(text, { rules: { ...config.rules, ...override?.rules, ...Object.fromEntries(others) }, override });
	return findings.filter((finding) => finding.severity === "error").map((f) => `line ${f.line + 1}: ${f.rule} ${f.message}`);
}

/** Checks `script` (absolute) before it goes to the game. */
export async function checkScript(script: string, options: GateOptions): Promise<GateResult> {
	const { root } = options;
	const config = loadConfig(root);
	const linted = await lintFile(script, config, projectCatalog(root));
	const errors = linted.findings.filter((finding) => finding.severity === "error");
	if (errors.length > 0) {
		return {
			ok: false,
			report: errors.map((f) => `${linted.path}:${f.line + 1}:${(f.column ?? 0) + 1} error ${f.rule} ${f.message}`),
		};
	}
	if (options.tests === false) return { ok: true, report: ["lint ok; tests not run (--no-tests)"] };

	const tests = await (options.findTests ?? projectTests)(root, script);
	if (tests.length === 0) return { ok: true, report: ["lint ok; no tests name this script"] };

	const names = tests.map((test) => relative(root, test).replaceAll("\\", "/"));
	const run = await (options.runTests ?? projectVitest)(root, tests);
	if (run.ok) return { ok: true, report: [`lint ok; tests pass: ${names.join(", ")}`] };
	const output = run.output.trimEnd().split(/\r?\n/);
	return { ok: false, report: [`tests fail: ${names.join(", ")}`, ...output.slice(-OUTPUT_LINES).map((line) => `  ${line}`)] };
}
