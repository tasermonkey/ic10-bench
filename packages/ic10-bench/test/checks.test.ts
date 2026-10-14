import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "@tasermonkey/ic10-lint";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type CheckContext, checkFindings, checkIdle, describeScriptChecks } from "../src/checks.ts";

const PROJECT = join(import.meta.dirname, "fixtures", "project");

// The fixture project's scripts, checked as a project's own test file would (with its catalogue,
// mods included, and its ic10-lint.json): a loop, a script that needs a device, one with an
// unused alias (a warning there), and one with comments past line 128 (an override).
describeScriptChecks({ root: PROJECT });

/** A test context that records what it's told. */
function fakeContext() {
	const annotations: [string, string | undefined][] = [];
	const skips: string[] = [];
	const context = {
		annotate: vi.fn(async (message: string, type?: string) => {
			annotations.push([message, type]);
			return { message, type: type ?? "notice" };
		}),
		skip: vi.fn((note?: string) => {
			skips.push(note ?? "");
		}),
	} as unknown as CheckContext;
	return { context, annotations, skips };
}

describe("a group's test", () => {
	it("fails with each error, line, rule and message", async () => {
		const { context } = fakeContext();
		const findings = await lint("move r0\nyield");
		await expect(checkFindings(context, findings.filter((f) => f.rule === "validate"))).rejects.toThrow(/line 1:\d+ validate: /);
	});

	it("passes with warnings, and shows them on the test", async () => {
		const { context, annotations } = fakeContext();
		await checkFindings(context, (await lint("alias Spare d0\nyield")).filter((f) => f.rule === "unused"));
		expect(annotations).toEqual([["line 1:7 unused: alias Spare is never used  (alias Spare d0)", "warning"]]);
	});
});

describe("the idle test", () => {
	const scratch = mkdtempSync(join(tmpdir(), "ic10-bench-idle-"));
	afterAll(() => rmSync(scratch, { recursive: true, force: true }));
	const script = (name: string, code: string) => {
		const file = join(scratch, `${name}.ic10`);
		writeFileSync(file, code);
		return file;
	};

	it("passes a script that yields, or ends", async () => {
		const { context, skips } = fakeContext();
		await checkIdle(context, PROJECT, join(PROJECT, "ic10", "loop.ic10"), "error");
		expect(skips).toEqual([]);
	});

	it("skips a script that needs a device it doesn't have", async () => {
		const { context, skips } = fakeContext();
		await checkIdle(context, PROJECT, join(PROJECT, "ic10", "rooms", "sensor.ic10"), "error");
		expect(skips).toEqual(["needs devices: Device on pin 0 not found at line 4"]);
	});

	it("fails a loop with no yield, and a halt", async () => {
		const { context } = fakeContext();
		await expect(checkIdle(context, PROJECT, script("spin", "loop:\nadd r0 r0 1\nj loop"), "error")).rejects.toThrow(
			/ran out of its 128 lines 50 times in 50 ticks \(last at line \d\): a loop with no yield or sleep/,
		);
		await expect(checkIdle(context, PROJECT, script("hcf", "move r0 1\nhcf"), "error")).rejects.toThrow(/halted at line 2 in tick 0/);
	});

	it("only warns when the config says warn", async () => {
		const { context, annotations } = fakeContext();
		await checkIdle(context, PROJECT, script("spin-warn", "loop:\nj loop"), "warn");
		expect(annotations).toEqual([[expect.stringMatching(/^idle: ran out of its 128 lines/), "warning"]]);
	});
});
