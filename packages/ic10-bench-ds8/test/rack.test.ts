/**
 * The DS-8 Server Rack in IC10 Bench: each behaviour here is the mod's own (ServerRack.dll 5.12.2,
 * decompiled; see the package's REFERENCE.md).
 */
import { type SimBuilder, sim, type World } from "@tasermonkey/ic10-bench";
import { describe, expect, it } from "vitest";
import { type RackOptions, serverRack } from "../src/index.ts";

const LOOP = "loop:\nadd r0 r0 1\nyield\nj loop";
const SPIN = "loop:\nj loop";

/** A world with a rack, and whatever `before` declares ahead of it. */
function build(options: RackOptions, before: (builder: SimBuilder) => SimBuilder = (b) => b): Promise<World> {
	return before(sim({ debug: false })).add("rack", serverRack, options).build();
}

const rack = (world: World) => serverRack.handle(world, "rack");

/** The (tick, chip) turns taken, in order, from the world's trace. */
function turns(world: World): string[] {
	const out: string[] = [];
	for (const entry of world.scheduler.trace) {
		const turn = `${entry.tick}:${entry.chip}`;
		if (out.at(-1) !== turn) out.push(turn);
	}
	return out;
}

describe("chips in the rack", () => {
	it("share d0-d5, and have the rack as db", async () => {
		const world = await build(
			{ pins: { d0: "sensor" }, chips: [{ key: "a", code: "l r0 d0 Temperature" }, { key: "b", code: "l r0 d0 Temperature" }] },
			(b) => b.device("sensor", "StructureGasSensor", { Temperature: 300 }),
		);
		await world.runTicks(1);
		expect(world.chip("a")).toHaveRegister("r0", 300);
		expect(world.chip("b")).toHaveRegister("r0", 300);
		expect(world.chip("a").db.key).toBe("rack");
		expect(world.chip("a").pins).toEqual({ d0: "sensor" });
	});

	it("run in processor order, where the rack is declared", async () => {
		const world = await build({ chips: [{ key: "one", code: LOOP }, undefined, { key: "three", code: LOOP }] }, (b) =>
			b.housing("before", { code: LOOP }),
		);
		await world.runTicks(1);
		expect(turns(world)).toEqual(["0:before", "0:one", "0:three"]);
	});

	it("run 128 lines a tick, as CLOCK, TURBO and the CPU multiplier set", async () => {
		const lines = async (options: RackOptions) => {
			const world = await build({ ...options, chips: [{ key: "a", code: SPIN }] });
			await world.runTicks(1);
			return world.chip("a").linesThisTick;
		};
		expect(await lines({})).toBe(128);
		expect(await lines({ switches: { turbo: true } })).toBe(256);
		expect(await lines({ switches: { clock: "LO" } })).toBe(32);
		expect(await lines({ cpuMultiplier: 0.5 })).toBe(64);
	});

	it("with RUN off, sit where they are and carry on when it's back on", async () => {
		const world = await build({ chips: [{ key: "a", code: LOOP }, { key: "b", code: LOOP }], switches: { run: [true, false] } });
		await world.runTicks(2);
		expect(world.chip("b")).toHaveRegister("r0", 0);
		expect(rack(world).processor(2).state).toBe("halted");
		rack(world).run(2, true);
		await world.runTicks(1);
		expect(world.chip("b")).toHaveRegister("r0", 1);
		expect(world.chip("b").restarts).toEqual([]);
	});

	it("held after power-up without autostart, until started", async () => {
		const world = await build({ chips: [{ key: "a", code: LOOP }], autostart: false });
		await world.runTicks(2);
		expect(world.chip("a")).toHaveRegister("r0", 0);
		expect(world.chip("a").status).toMatch(/^held by "rack"/);
		rack(world).start();
		await world.runTicks(1);
		expect(world.chip("a")).toHaveRegister("r0", 1);
	});

	it("stop when the rack is switched off, and carry on where they were when it's on again", async () => {
		// In game (2026-10-20): the line, the registers and the memory are as they were.
		const world = await build({ chips: [{ key: "a", code: LOOP }] });
		await world.runTicks(2);
		world.device("rack").set("On", 0);
		await world.runTicks(2);
		expect(rack(world).processor(1).state).toBe("halted");
		expect(world.chip("a")).toHaveRegister("r0", 2);
		world.device("rack").set("On", 1);
		await world.runTicks(1);
		expect(world.chip("a").restarts).toEqual([]);
		expect(world.chip("a")).toHaveRegister("r0", 3);
	});

	it("don't start without a system board", async () => {
		const world = await build({ chips: [{ key: "a", code: LOOP }], motherboard: false });
		await world.runTicks(2);
		expect(rack(world).processor(1).state).toBe("halted");
		expect(world.chip("a")).toHaveRegister("r0", 0);
	});

	it("see the rack's slots: drives, chips and the system board", async () => {
		const world = await build({
			drives: [1],
			chips: [{ key: "a", code: "ls r0 db 0 Occupied\nls r1 db 1 Occupied\nls r2 db 8 Occupied\nls r3 db 9 Occupied\nls r4 db 12 Occupied" }],
		});
		await world.runTicks(1);
		expect([0, 1, 2, 3, 4].map((r) => world.chip("a").reg(`r${r}`))).toEqual([1, 0, 1, 0, 1]);
	});
});

describe("the patch field and the I/O ports", () => {
	const twoSensors = (b: SimBuilder) => b.device("one", "StructureGasSensor", { Temperature: 1 }).device("two", "StructureGasSensor", { Temperature: 2 });
	const READ = "loop:\nl r0 d0 Temperature\nyield\nj loop";

	it("puts a pin's device on the port its cable reaches, which a patch moves", async () => {
		const world = await build({ pins: { d0: "one" }, patch: { d0: 4 }, chips: [{ key: "a", code: READ }] }, twoSensors);
		await world.runTicks(1);
		expect(world.chip("a")).toHaveRegister("r0", 1);
		expect(rack(world).portDevice(4)).toBe("one");
		expect(rack(world).patchOf("d0")).toBe(4);
	});

	it("sees a cable moved mid-test", async () => {
		// Port 7: no pin's cable reaches it at first (d0-d5 go to ports 1-6).
		const world = await build({ pins: { d0: "one" }, ports: { 7: "two" }, chips: [{ key: "a", code: READ }] }, twoSensors);
		await world.runTicks(1);
		expect(world.chip("a").pins).toEqual({ d0: "one" });
		rack(world).patch("d0", 7);
		await world.runTicks(1);
		expect(world.chip("a")).toHaveRegister("r0", 2);
		expect(world.chip("a").pins).toEqual({ d0: "two" });
	});

	it("gives a pin with no cable the first free port with assignPin, as the Network program does", async () => {
		const world = await build({ patch: { d1: null }, chips: [{ key: "a", code: "loop:\nl r0 d1 Temperature\nyield\nj loop" }] }, twoSensors);
		rack(world).assignPin("d1", "two");
		await world.runTicks(1);
		expect(rack(world).patchOf("d1")).toBe(2);
		expect(world.chip("a")).toHaveRegister("r0", 2);
	});

	it("leaves a port empty for a device that isn't on the rack's network", async () => {
		const world = await sim({ debug: false })
			.network("data")
			.network("other")
			.device("far", "StructureGasSensor", {}, { network: "other" })
			.add("rack", serverRack, { pins: { d0: "far" }, chips: [{ key: "a", code: "l r0 d0 Temperature" }] }, { network: "data" })
			.build();
		await world.runTicks(1);
		expect(world.chip("a").halt?.error.message).toMatch(/not found/i);
	});

	it("with I/O off, leaves every pin empty", async () => {
		const world = await build({ pins: { d0: "one" }, switches: { io: false }, chips: [{ key: "a", code: "l r0 d0 Temperature" }] }, twoSensors);
		await world.runTicks(1);
		expect(world.chip("a").halt?.error.message).toMatch(/not found/i);
	});

	it("with I/O off, stops a batch instruction with DeviceListNull, and finds nothing by ID", async () => {
		// In game (2026-10-20): `lb` stopped with DeviceListNull; the ports' IDs still read.
		const batch = await build({ switches: { io: false }, chips: [{ key: "a", code: "lb r0 HASH(\"StructureGasSensor\") Temperature Sum" }] }, twoSensors);
		await batch.runTicks(1);
		expect(batch.chip("a").halt?.error.message).toMatch(/DeviceListNull/);

		const byId = await build({ ports: { 9: "two" }, switches: { io: false }, chips: [{ key: "a", code: "get r1 db 4160\nld r0 r1 Temperature" }] }, twoSensors);
		await byId.runTicks(1);
		expect(byId.chip("a")).toHaveRegister("r1", byId.device("two").id);
		expect(byId.chip("a").halt).not.toBeNull();
	});

	it("keeps each port's device ID in memory, for ld and sd", async () => {
		const world = await build(
			{ pins: { d0: "one" }, ports: { 9: "two" }, chips: [{ key: "a", code: "get r1 db 4128\nget r2 db 4160\nld r0 r2 Temperature" }] },
			twoSensors,
		);
		await world.runTicks(1);
		expect(world.chip("a")).toHaveRegister("r1", world.device("one").id);
		expect(world.chip("a")).toHaveRegister("r0", 2);
	});
});

describe("the rack's memory", () => {
	it("is what get, put and clr reach on db; a chip's own stack stays its own", async () => {
		const world = await build({ chips: [{ key: "a", code: "put db 5 42\nget r0 db 5\npush 7" }] });
		await world.runTicks(1);
		expect(world.chip("a")).toHaveRegister("r0", 42);
		expect(world.chip("a").stackAt(0)).toBe(7);
		expect(rack(world).memory(5)).toBe(42);
		expect(rack(world).memory(0)).toBe(0);
	});

	it("tells each chip which processor it is, and 0 to a chip elsewhere", async () => {
		const ASK = "get r0 db 4127";
		const world = await build({ chips: [{ key: "first", code: ASK }, , , , { key: "fifth", code: ASK }] }, (b) =>
			b.housing("outside", { code: "get r0 d0 4127", pins: { d0: "rack" } }),
		);
		await world.runTicks(1);
		expect(world.chip("first")).toHaveRegister("r0", 1);
		expect(world.chip("fifth")).toHaveRegister("r0", 5);
		expect(world.chip("outside")).toHaveRegister("r0", 0);
	});

	it("reads 0 for a bank with no drive, and drops a write to it, counting faults", async () => {
		const world = await build({ drives: [1], chips: [{ key: "a", code: "put db 600 3\nget r0 db 600\nput db 1 9" }] });
		await world.runTicks(1);
		expect(world.chip("a").halted).toBe(false);
		expect(rack(world).memory(1)).toBe(9);
		expect(rack(world).faults).toBe(2);
		expect(rack(world).writes).toBe(1);
	});

	it("drops writes from its own chips with MEM WR off, but not from a chip elsewhere", async () => {
		const world = await build({ switches: { memWrite: false }, chips: [{ key: "a", code: "put db 1 9" }] }, (b) =>
			b.housing("outside", { code: "put d0 2 8", pins: { d0: "rack" } }),
		);
		await world.runTicks(1);
		expect(rack(world).memory(1)).toBe(0);
		expect(rack(world).memory(2)).toBe(8);
	});

	it("drops every write while locked (write protect)", async () => {
		const world = await build({ chips: [{ key: "a", code: "s db Lock 1\nput db 1 9\nclr db" }], memory: { 3: 5 } });
		await world.runTicks(1);
		expect(rack(world).memory(1)).toBe(0);
		expect(rack(world).memory(3)).toBe(5);
		expect(world.device("rack").get("Lock")).toBe(1);
	});

	it("is formatted by clr", async () => {
		const world = await build({ memory: { 3: 5, 600: 1 }, chips: [{ key: "a", code: "clr db" }] });
		await world.runTicks(1);
		expect(rack(world).memory(3)).toBe(0);
		expect(rack(world).memory(600)).toBe(0);
	});

	it("follows a drive moved to another bank, and goes with a pulled drive", async () => {
		const world = await build({ memory: { 3: 5 } });
		const handle = rack(world);
		handle.bank(1, null).bank(2, null).bank(1, 1);
		expect(handle.memory(512 + 3)).toBe(5);
		const cells = handle.removeDrive(1);
		expect(cells[3]).toBe(5);
		expect(handle.memory(512 + 3)).toBe(0);
	});

	it("halts a chip for an address below 0 or past the status registers", async () => {
		const under = await build({ chips: [{ key: "a", code: "get r0 db -1" }] });
		await under.runTicks(1);
		expect(under.chip("a").halt?.error.message).toMatch(/StackUnderFlow/);
		const over = await build({ chips: [{ key: "a", code: "get r0 db 4184" }] });
		await over.runTicks(1);
		expect(over.chip("a").halt?.error.message).toMatch(/StackOverFlow/);
	});

	it("follows the drive capacity", async () => {
		const world = await build({ driveCapacity: 64, chips: [{ key: "a", code: "get r0 db 512\nl r1 db StackSize" }] });
		await world.runTicks(1);
		expect(world.chip("a")).toHaveRegister("r0", 45); // core temperature: status register 0
		expect(world.chip("a")).toHaveRegister("r1", 512);
	});
});

describe("the status registers", () => {
	it("give the rack's state above the drives", async () => {
		const world = await build({
			drives: [1, 2],
			memory: { 0: 7 },
			status: { upsRatio: 0.5 },
			chips: [{ key: "a", code: "get r0 db 4096\nget r1 db 4098\nget r2 db 4106\nget r3 db 4107\nget r4 db 4108\nget r5 db 4116\nget r6 db 4120" }],
		});
		await world.runTicks(1);
		const reg = (r: number) => world.chip("a").reg(`r${r}`);
		expect([0, 1, 2, 3, 4, 5].map(reg)).toEqual([45, 0.5, 2, 1, 1024, 2]);
	});

	it("let chips share the eight scratch cells, and refuse writes to the rest", async () => {
		const world = await build({ chips: [{ key: "a", code: "put db 4136 3\nput db 4100 9" }, { key: "b", code: "get r0 db 4136\nget r1 db 4100" }] });
		await world.runTicks(1);
		expect(world.chip("b")).toHaveRegister("r0", 3);
		expect(world.chip("b")).toHaveRegister("r1", 1); // the air filter, unchanged
		expect(rack(world).faults).toBe(1);
	});

	it("show a halted chip as an error, to the chips after it", async () => {
		const world = await build({ chips: [{ key: "a", code: "get r0 db -1" }, { key: "b", code: "get r0 db 4116\nget r1 db 4117\nget r2 db 4118" }] });
		await world.runTicks(1);
		expect(world.chip("b")).toHaveRegister("r0", 3);
		expect(world.chip("b")).toHaveRegister("r1", 2);
		expect(world.chip("b")).toHaveRegister("r2", 0);
		expect(rack(world).processor(1).state).toBe("error");
	});
});

describe("the rack's logic", () => {
	it("reads and writes the cell at Index as Setting, from a chip elsewhere", async () => {
		const world = await build({}, (b) => b.housing("outside", { code: "s d0 Index 10\ns d0 Setting 4\nl r0 d0 Setting\nl r1 d0 Quantity", pins: { d0: "rack" } }));
		await world.runTicks(1);
		expect(rack(world).memory(10)).toBe(4);
		expect(world.chip("outside")).toHaveRegister("r0", 4);
		expect(world.chip("outside")).toHaveRegister("r1", 1);
		expect(world.device("rack").get("Setting")).toBe(4);
		expect(world.device("rack").get("Ratio")).toBe(1 / 4096);
	});

	it("drops writes from elsewhere with REM off or MAINT on, but not its own chips'", async () => {
		const world = await build({ switches: { remote: false }, chips: [{ key: "a", code: "s db Mode 3" }] }, (b) =>
			b.housing("outside", { code: "s d0 Index 10", pins: { d0: "rack" } }),
		);
		await world.runTicks(1);
		expect(world.device("rack").get("Index")).toBe(0);
		expect(world.device("rack").get("Mode")).toBe(3);
		expect(rack(world).faults).toBe(1);
	});

	it("gives the PROG processor's line as LineNumber", async () => {
		const world = await build({ chips: [{ key: "a", code: "move r1 1\nyield\nj 0" }, { key: "b", code: "yield" }], switches: { prog: 2 } }, (b) =>
			b.housing("outside", { code: "loop:\nl r0 d0 LineNumber\nyield\nj loop", pins: { d0: "rack" } }),
		);
		await world.runTicks(2);
		expect(rack(world).processor(2).line).toBe(1);
		expect(world.chip("outside")).toHaveRegister("r0", rack(world).processor(2).line);
	});
});

describe("serverRack's options", () => {
	it("are checked before anything is built", async () => {
		const chips = Array.from({ length: 13 }, (_, i) => ({ key: `c${i}`, code: "yield" }));
		await expect(build({ chips })).rejects.toThrow('server rack "rack": chips: 13 chips, but the rack has 12 sockets');
		await expect(build({ chips: [{ key: "a", code: "" }, { key: "a", code: "" }] })).rejects.toThrow('chips: "a" is in two sockets');
		await expect(build({ pins: { d0: "nothing" } })).rejects.toThrow('server rack "rack": no device "nothing"');
		await expect(build({ ports: { 40: "x" } })).rejects.toThrow("ports: no port 40 (use 1-32)");
		await expect(build({ patch: { d0: null }, pins: { d0: "x" } })).rejects.toThrow("pins.d0: its patch cable is unplugged");
		await expect(build({ drives: [1], memory: { 600: 1 } })).rejects.toThrow("memory 600: no drive is patched to bank 1");
	});
});
