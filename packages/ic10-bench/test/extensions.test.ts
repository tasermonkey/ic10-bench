/**
 * Device kinds from extension packages: `sim().add(key, kind, options)`. The kind here is a test
 * box hosting two chips (fixtures/box-kind.ts), standing in for a modded device; the harness knows
 * nothing about it beyond what a kind gives it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type CheckContext, checkIdle } from "../src/checks.ts";
import { evaluate } from "../src/debug/evaluate.ts";
import { Inspector } from "../src/debug/inspect.ts";
import { type DeviceKind, sim, type World } from "../src/index.ts";
import { chipReport } from "../src/matchers/report.ts";
import { Box, type BoxOptions, box } from "./fixtures/box-kind.ts";

const LOOP = "loop:\nadd r0 r0 1\nyield\nj loop";
/** Copies d0's Setting into r0 every tick. */
const READ_D0 = "loop:\nl r0 d0 Setting\nyield\nj loop";

function boxed(world: World): Box {
	return world.device("box").raw as Box;
}

/** The (tick, chip) turns taken, in order, from the world's trace. */
function turns(world: World): string[] {
	const out: string[] = [];
	for (const entry of world.scheduler.trace) {
		const turn = `${entry.tick}:${entry.chip}`;
		if (out.at(-1) !== turn) out.push(turn);
	}
	return out;
}

describe("a device kind's device", () => {
	it("is built by the kind, on its network, with the props the test gives", async () => {
		const world = await sim({ debug: false }).add("box", box, { chips: [] }, { props: { Setting: 4 }, name: "Big Box" }).build();
		const device = world.device("box");
		expect(device.raw).toBeInstanceOf(Box);
		expect(device.prefab).toBe("ModularDeviceLEDdisplay3");
		expect(device.name).toBe("Big Box");
		expect(device.get("Setting")).toBe(4);
		expect(world.listChips()).toEqual([]);
	});

	it("needs its prefab in the catalogue", async () => {
		const unknown: DeviceKind<BoxOptions> = { ...box, prefab: "NoSuchDevice" };
		await expect(sim({ debug: false }).add("box", unknown, { chips: [] }).build()).rejects.toThrow(
			/"box": no device NoSuchDevice in the emulator or the project's ic10-mods\//,
		);
	});

	it("checks its options with the kind before anything is built", async () => {
		await expect(sim({ debug: false }).add("box", box, { chips: [], d0: "nothing" }).build()).rejects.toThrow('box "box": no device "nothing"');
	});
});

describe("chips a device kind hosts", () => {
	it("run where the host is declared, in the order the kind gives them", async () => {
		const world = await sim({ debug: false })
			.housing("first", { code: LOOP })
			.add("box", box, { chips: [{ key: "a", code: LOOP }, { key: "b", code: LOOP }] })
			.housing("last", { code: LOOP })
			.build();
		await world.runTicks(2);
		expect(turns(world)).toEqual(["0:first", "0:a", "0:b", "0:last", "1:first", "1:a", "1:b", "1:last"]);
		expect(world.listChips().map((c) => c.key)).toEqual(["first", "a", "b", "last"]);
	});

	it("have the host as db: memory and logic are the host's, the stack is the chip's own", async () => {
		const world = await sim({ debug: false })
			.add("box", box, { chips: [{ key: "a", code: "put db 3 7\nl r0 db Setting\npush 9" }] }, { props: { Setting: 5 } })
			.build();
		await world.runTicks(1);
		const chip = world.chip("a");
		expect(chip.db.key).toBe("box");
		expect(world.db("a").key).toBe("box");
		expect(chip).toHaveRegister("r0", 5);
		expect(world.device("box").stackAt(3)).toBe(7);
		expect(chip.stackAt(0)).toBe(9);
		expect(world.device("box").stackAt(0)).toBe(0);
		expect(world.value("a.Setting")).toBe(5);
		expect(world.value("a.r0")).toBe(5);
	});

	it("share the pins the host gives them, and see it re-patched", async () => {
		const world = await sim({ debug: false })
			.device("one", "StructureActiveVent", { Setting: 1 })
			.device("two", "StructureActiveVent", { Setting: 2 })
			.add("box", box, { chips: [{ key: "a", code: READ_D0 }, { key: "b", code: READ_D0 }], d0: "one" })
			.build();
		await world.runTicks(1);
		expect(world.chip("a")).toHaveRegister("r0", 1);
		expect(world.chip("b")).toHaveRegister("r0", 1);
		expect(world.chip("a").pins).toEqual({ d0: "one" });

		boxed(world).d0 = { key: "two", id: world.device("two").id };
		await world.runTicks(1);
		expect(world.chip("a")).toHaveRegister("r0", 2);
		expect(world.chip("b").pins).toEqual({ d0: "two" });
	});

	it("run the lines the host allows, asked at the start of each turn", async () => {
		const world = await sim({ debug: false }).add("box", box, { chips: [{ key: "a", code: "loop:\nj loop" }] }).build();
		boxed(world).lines = 3;
		await world.runTicks(1);
		expect(world.chip("a").linesThisTick).toBe(3);
		expect(world.chip("a").linesPerTick).toBe(3);

		boxed(world).lines = 5;
		await world.runTicks(1);
		expect(world.chip("a").linesThisTick).toBe(5);
		expect(world.chip("a").autoYields).toBe(2);
	});

	it("are skipped without power, and restart from line 0 when it's back", async () => {
		const world = await sim({ debug: false }).add("box", box, { chips: [{ key: "a", code: LOOP }] }).build();
		await world.runTicks(2);
		boxed(world).powered = false;
		await world.runTicks(2);
		const chip = world.chip("a");
		expect(chip).toHaveRegister("r0", 2);
		expect(chip.switchedOff).toBe(true);
		expect(chip.status).toMatch(/^switched off \(no power from "box"\)/);

		boxed(world).powered = true;
		await world.runTicks(1);
		expect(chip.restarts).toEqual([4]);
		expect(chip).toHaveRegister("r0", 3);
	});

	it("held, sit their turns out and carry on where they were", async () => {
		const world = await sim({ debug: false }).add("box", box, { chips: [{ key: "a", code: LOOP }] }).build();
		await world.runTicks(1);
		boxed(world).held.add("a");
		await world.runTicks(2);
		const chip = world.chip("a");
		expect(chip).toHaveRegister("r0", 1);
		expect(chip.status).toMatch(/^held by "box" at line 3/);

		boxed(world).held.delete("a");
		await world.runTicks(1);
		expect(chip.restarts).toEqual([]);
		expect(chip).toHaveRegister("r0", 2);
	});

	it("tell the host before and after each line they run", async () => {
		const world = await sim({ debug: false })
			.add("box", box, { chips: [{ key: "a", code: "move r0 1\nyield" }, { key: "b", code: "yield" }] })
			.build();
		await world.runTicks(1);
		expect(boxed(world).steps).toEqual(["before a", "after a", "before a", "after a", "before b", "after b"]);

		await world.step(1, "b");
		expect(boxed(world).steps.slice(-2)).toEqual(["before b", "after b"]);
	});

	it("can't take a key the world already has", async () => {
		await expect(
			sim({ debug: false })
				.device("vent", "StructureActiveVent")
				.add("box", box, { chips: [{ key: "vent", code: LOOP }] })
				.build(),
		).rejects.toThrow('sim: "box" hosts a chip "vent", a key the world already has');
	});

	it("show their host as db in reports, the debugger's Devices and its expressions", async () => {
		const world = await sim({ debug: false })
			.device("one", "StructureActiveVent", { Setting: 1 })
			.add("box", box, { chips: [{ key: "a", code: "put db 2 6\nyield" }], d0: "one" }, { props: { Setting: 8 } })
			.build();
		await world.runTicks(1);
		const chip = world.chip("a");

		expect(chipReport(chip)).toMatch(/ {2}d0 → one {2}StructureActiveVent .*\n[\s\S]* {2}db → box {2}ModularDeviceLEDdisplay3/);
		expect(evaluate(chip, "db.Setting")).toBe(8);
		expect(evaluate(chip, "db.stack[2]")).toBe(6);
		expect(evaluate(chip, "d0.Setting")).toBe(1);

		const inspector = new Inspector();
		const devices = inspector.scopes(chip).find((s) => s.name === "Devices")!;
		expect(inspector.variables(devices.ref).map((v) => v.name)).toEqual(["d0 → one", "db → box"]);
	});
});

describe("the idle check of a script a device kind hosts", () => {
	const PROJECT = join(import.meta.dirname, "fixtures", "project");
	const scratch = mkdtempSync(join(tmpdir(), "ic10-bench-kind-idle-"));
	afterAll(() => rmSync(scratch, { recursive: true, force: true }));
	const script = (name: string, code: string, json?: object) => {
		const file = join(scratch, `${name}.ic10`);
		writeFileSync(file, code);
		if (json) writeFileSync(`${file}.json`, JSON.stringify(json));
		return file;
	};
	const context = () => ({ annotate: vi.fn(), skip: vi.fn() }) as unknown as CheckContext;

	it("runs it in the kind's device, with stand-ins on the pins the kind gives it", async () => {
		// The box's memory is 16 cells: in a circuit housing (512) this would pass either way.
		const file = script("boxed", "l r0 d0 Temperature\nget r1 db 15\nyield\nj 0", { host: "ModularDeviceLEDdisplay3" });
		await checkIdle(context(), PROJECT, file, "error", [box]);
		const overflow = script("overflow", "get r1 db 20\nyield", { host: "ModularDeviceLEDdisplay3" });
		await expect(checkIdle(context(), PROJECT, overflow, "error", [box])).rejects.toThrow(/halted at line 1/);
	});

	it("fails when the extension for its host wasn't given", async () => {
		const file = script("orphan", "yield", { host: "ModularDeviceLEDdisplay3" });
		await expect(checkIdle(context(), PROJECT, file, "error")).rejects.toThrow(
			"its host is ModularDeviceLEDdisplay3: pass that extension's device kind to describeScriptChecks({ extensions })",
		);
	});
});
