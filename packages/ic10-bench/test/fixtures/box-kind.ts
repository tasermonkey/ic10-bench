/**
 * A device kind for the extension tests, standing in for a modded device that hosts several chips:
 * a chip box (`ModFixtureChipBox`, in the fixture project's ic10-mods/) with two processor slots,
 * 16 cells of memory of its own, and one shared pin, d0, that every chip in it sees and a test can
 * re-patch.
 */
import { Chip, type Device, HashString, ItemEntity, Stack, StructureCircuitHousing, Structure } from "@tasermonkey/ic10";
import type { DeviceKind, HostedChip } from "../../src/index.ts";

/** Its processor slots: chip n goes in slot n − 1. */
const SOCKETS = 2;

export interface BoxOptions {
	chips: { key: string; code?: string; file?: string }[];
	/** The device (by key) every chip's d0 is wired to. */
	d0?: string;
}

export class Box extends Structure {
	readonly cells = new Stack(16);
	/** The device on d0, by key and reference ID. */
	d0: { key: string; id: number } | undefined;
	lines = 128;
	powered = true;
	readonly held = new Set<string>();
	/** Every beforeStep and afterStep call, in order. */
	readonly steps: string[] = [];

	override get memory() {
		return this.cells ?? super.memory;
	}

	override get hasMemory() {
		return true;
	}
}

/** A chip's place in the box: `db` is the box, d0 the box's shared pin, and it's on the box's network. */
class BoxSocket extends StructureCircuitHousing {
	box?: Box;

	override get network() {
		return this.box ? this.box.network : super.network;
	}

	override getConnectedDevices(pin: number): Device | undefined {
		const box = this.box;
		if (!box) return super.getConnectedDevices(pin);
		if (pin < 0) return box;
		return pin === 0 && box.d0 ? box.network.deviceById(box.d0.id) : undefined;
	}
}

export const box: DeviceKind<BoxOptions> = {
	prefab: "ModFixtureChipBox",

	validate(options, { key, keys }) {
		if (options.chips.length > SOCKETS) throw new Error(`box "${key}": ${options.chips.length} chips, but it has ${SOCKETS} slots`);
		if (options.d0 !== undefined && !keys.has(options.d0)) throw new Error(`box "${key}": no device "${options.d0}"`);
	},

	create(context, options) {
		const device = new Box({ id: context.id, hash: context.hash });
		const d0 = options.d0;
		if (d0 !== undefined) device.d0 = { key: d0, id: context.idOf(d0)! };
		const chips = options.chips.map((spec, slot): HostedChip => {
			const program = context.program(spec, `chip "${spec.key}"`);
			const chip = new Chip({ id: 0, ic10Code: program.code, register_length: 18, stack_length: 512 });
			const housing = new BoxSocket({ id: context.nextId(), chip });
			housing.box = device;
			// The chip in its slot, as the game shows it (ls db 0 Occupied).
			const item = new ItemEntity(new HashString("ItemIntegratedCircuit10").hash, 1);
			item.setProp("Occupied", 1);
			item.setProp("OccupantHash", item.hash);
			device.slots?.getSlot(slot)?.putItem(item, true);
			return {
				key: spec.key,
				housing,
				source: program.source,
				pins: () => (device.d0 ? { d0: device.d0.key } : {}),
				linesPerTick: () => device.lines,
				powered: () => device.powered,
				held: () => device.held.has(spec.key),
				beforeStep: () => device.steps.push(`before ${spec.key}`),
				afterStep: () => device.steps.push(`after ${spec.key}`),
			};
		});
		return { device, chips };
	},

	idle(file, stubs) {
		return { options: { chips: [{ key: "boxed", file }], d0: stubs.pins.d0 }, chip: "boxed" };
	},
};
