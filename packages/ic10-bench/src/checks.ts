/**
 * Every script in a project checked, from one line in a test file:
 *
 * ```ts
 * import { describeScriptChecks } from "@tasermonkey/ic10-bench/checks";
 *
 * describeScriptChecks();
 * ```
 *
 * For each script under the `dir` in the project's `ic10-lint.json` (default `ic10/`), one test per
 * group of @tasermonkey/ic10-lint's rules, checked against the project's device catalogue (mods
 * included), and an `idle` test that runs the script for 50 ticks with nothing connected. A rule
 * the config sets to "warn" passes, and its findings show as warnings on the test.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	type FileReport,
	type Finding,
	findScripts,
	lintFile,
	loadConfig,
	normalizeSeverity,
	projectRelative,
	type SeveritySetting,
} from "@tasermonkey/ic10-lint";
import { describe, expect, it, type TestContext } from "vitest";
import { loadCatalog } from "./catalog/catalog.ts";
import { projectRoot } from "./project.ts";
import { sim } from "./world/sim.ts";

/** The tests made for each script, and the ic10-lint rules each one runs. */
export const CHECK_GROUPS: Record<string, readonly string[]> = {
	limits: ["max-lines", "max-columns", "max-bytes"],
	loads: ["validate"],
	devices: ["batch-ops", "hash-name"],
	style: ["relative-branch-to-label", "absolute-jump-number", "unused", "register-flow"],
};

/** The idle run's length, and what it's for. */
export const IDLE_TICKS = 50;

/** The halts that mean the script needs a device the idle run doesn't build. */
const NEEDS_DEVICE = /Device on pin \d+ not found|must be device id|device (?:is )?not (?:found|set)/i;

export interface ScriptChecksOptions {
	/** The project's folder. Default: the project `defineIc10Config` set, or the working directory. */
	root?: string;
	/** The config file, if not `ic10-lint.json` in the project's folder. */
	config?: string;
}

const where = (f: Finding) => `line ${f.line + 1}:${f.column + 1} ${f.rule}: ${f.message}${f.text ? `  (${f.text})` : ""}`;

/** What the checks use of Vitest's test context. */
export type CheckContext = Pick<TestContext, "annotate" | "skip">;

/** @internal A group's test: fail with the errors; show the warnings on the test. */
export async function checkFindings(context: CheckContext, findings: Finding[]): Promise<void> {
	for (const f of findings.filter((f) => f.severity === "warning")) await context.annotate(where(f), "warning");
	const errors = findings.filter((f) => f.severity === "error").map(where);
	expect(errors, errors.join("\n")).toEqual([]);
}

/**
 * @internal The idle test: build only the script's housing, run it, and fail on a halt or an
 * automatic yield. A halt for a missing device skips it instead.
 */
export async function checkIdle(context: CheckContext, root: string, file: string, severity: SeveritySetting): Promise<void> {
	let world: Awaited<ReturnType<ReturnType<typeof sim>["build"]>>;
	try {
		world = await sim({ root, debug: false }).housing("ic", { file }).build();
	} catch (error) {
		context.skip(`doesn't load, so it can't run (see "loads"): ${(error as Error).message}`);
		return;
	}
	await world.runTicks(IDLE_TICKS);
	const chip = world.chip("ic");
	const halt = chip.halt;
	if (halt && NEEDS_DEVICE.test(halt.error.message)) {
		context.skip(`needs devices: ${halt.error.message} at line ${halt.line + 1}`);
		return;
	}
	const problems: string[] = [];
	if (halt) problems.push(`halted at line ${halt.line + 1} in tick ${halt.tick}: ${halt.error.message}`);
	if (chip.autoYields > 0) {
		const last = chip.autoYieldLog.at(-1)!;
		problems.push(
			`ran out of its 128 lines ${chip.autoYields} times in ${IDLE_TICKS} ticks (last at line ${last.line + 1}): a loop with no yield or sleep`,
		);
	}
	if (normalizeSeverity(severity) === "warning") {
		for (const problem of problems) await context.annotate(`idle: ${problem}`, "warning");
		return;
	}
	expect(problems, problems.join("\n")).toEqual([]);
}

/** Describe the checks for every script in the project. Call it at the top level of a test file. */
export function describeScriptChecks(options: ScriptChecksOptions = {}): void {
	const root = resolve(options.root ?? projectRoot());
	const config = loadConfig(root, options.config);
	const catalog = loadCatalog(root);
	const scripts = existsSync(config.dir) ? findScripts(config.dir) : [];
	const idleSeverity = config.rules.idle ?? "error";

	const reports = new Map<string, Promise<FileReport>>();
	const lintOnce = (file: string) => {
		let pending = reports.get(file);
		if (!pending) reports.set(file, (pending = lintFile(file, config, catalog)));
		return pending;
	};

	describe("scripts", () => {
		it(`finds scripts in ${projectRelative(root, config.dir) || "."}`, () => {
			expect(scripts.length, `no .ic10 files under ${config.dir}`).toBeGreaterThan(0);
		});

		it("has overrides only for scripts that exist", () => {
			const known = new Set(scripts.map((file) => projectRelative(root, file)));
			expect(Object.keys(config.overrides).filter((path) => !known.has(path))).toEqual([]);
		});

		for (const file of scripts) {
			describe(projectRelative(root, file), () => {
				for (const [group, rules] of Object.entries(CHECK_GROUPS)) {
					it(group, async (context) => {
						const { findings } = await lintOnce(file);
						await checkFindings(context, findings.filter((f) => rules.includes(f.rule)));
					});
				}
				if (normalizeSeverity(idleSeverity) !== "off") {
					it("idle", (context) => checkIdle(context, root, file, idleSeverity));
				}
			});
		}
	});
}
