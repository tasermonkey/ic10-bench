import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "@tasermonkey/ic10-lint";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type CheckContext, checkFindings, checkIdle, describeScriptChecks, referenceIdLiterals } from "../src/checks.ts";

const PROJECT = join(import.meta.dirname, "fixtures", "project");

// The fixture project's scripts, checked as a project's own test file would (with its catalogue,
// mods included, and its ic10-lint.json): a loop, a script that reads a device, one with an
// unused alias (a warning there), one with comments past line 128 (an override), and a loop with
// no yield whose override turns its idle test down to a warning.
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

	it("puts a stand-in device on every pin: every logic type and every slot, reading 0", async () => {
		const { context, skips } = fakeContext();
		await checkIdle(context, PROJECT, join(PROJECT, "ic10", "rooms", "sensor.ic10"), "error");
		const code = "start:\nl r0 d0 Temperature\nls r1 d5 3 Occupied\ns d2 On 1\nbdns d4 start\nyield\nj start";
		await checkIdle(context, PROJECT, script("pins", code), "error");
		expect(skips).toEqual([]);
	});

	it("and one at every reference ID the script writes", async () => {
		const { context, skips } = fakeContext();
		const code = "define Fab $1488\nstart:\nld r0 Fab On\nsd 797452 Setting r0\nls r1 %101 0 Quantity\nyield\nj start";
		await checkIdle(context, PROJECT, script("ids", code), "error");
		expect(skips).toEqual([]);
	});

	it("lets the housing answer the logic types of the device it's meant to sit in", async () => {
		const { context, skips } = fakeContext();
		const code = "start:\nl r0 db TemperatureInput\ns db Mode r0\ns db SoundAlert 1\nyield\nj start";
		await checkIdle(context, PROJECT, script("db", code), "error");
		expect(skips).toEqual([]);
	});

	it("keeps the housing's own logic types' rules", async () => {
		const { context } = fakeContext();
		await expect(checkIdle(context, PROJECT, script("db-own", "s db PrefabHash 1\nyield"), "error")).rejects.toThrow(
			/halted at line 1 in tick 0: .*can't write PrefabHash: it's read-only/,
		);
	});

	it("skips a script that finds a device by an ID it works out", async () => {
		const { context, skips } = fakeContext();
		await checkIdle(context, PROJECT, script("computed", "move r1 2\nmul r1 r1 3\nld r0 r1 On\nyield"), "error");
		expect(skips).toEqual([expect.stringMatching(/^needs devices: .* at line 3$/)]);
	});

	it("fails a loop with no yield, and a halt", async () => {
		const { context } = fakeContext();
		await expect(checkIdle(context, PROJECT, script("spin", "loop:\nadd r0 r0 1\nj loop"), "error")).rejects.toThrow(
			/ran out of its 128 lines 50 times in 50 ticks \(last at line \d\): a loop with no yield or sleep/,
		);
		await expect(checkIdle(context, PROJECT, script("hcf", "move r0 1\nhcf"), "error")).rejects.toThrow(/halted at line 2 in tick 0/);
	});

	it("still fails a loop with no yield that only stand-ins let it reach", async () => {
		const { context } = fakeContext();
		const code = "start:\nl r0 d0 On\nbeqz r0 start\nyield\nj start";
		await expect(checkIdle(context, PROJECT, script("waits", code), "error")).rejects.toThrow(/ran out of its 128 lines/);
	});

	it("only warns when the config says warn", async () => {
		const { context, annotations } = fakeContext();
		await checkIdle(context, PROJECT, script("spin-warn", "loop:\nj loop"), "warn");
		expect(annotations).toEqual([[expect.stringMatching(/^idle: ran out of its 128 lines/), "warning"]]);
	});
});

describe("the reference IDs a script writes", () => {
	it("are its positive whole numbers, in decimal, $hex or %binary", () => {
		const source = 'define Fab $1488\nmove r0 %101\nld r1 797452 On\nmove r2 HASH("X")\nmove r3 -5\nmove r4 1.5 # 999\nj 0';
		expect(referenceIdLiterals(source).sort((a, b) => a - b)).toEqual([5, 0x1488, 797452]);
	});
});
