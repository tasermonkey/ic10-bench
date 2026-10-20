/**
 * `serverRack`: the DS-8 Server Rack as an IC10 Bench device kind.
 *
 *     sim().add("rack", serverRack, { pins: { d0: "sensor" }, chips: [{ key: "airlock", file }] })
 *
 * Numbers are as the game shows them: processors 1-12, I/O ports 1-32, bays 1-8, banks 0-7.
 */
import { Chip } from "@tasermonkey/ic10";
import type { DeviceKind, HostedChip, World } from "@tasermonkey/ic10-bench";
import {
	CLOCK_LINES,
	type ClockSetting,
	type CpuMultiplier,
	DEFAULT_DRIVE_CAPACITY,
	DRIVE_BAYS,
	IO_PORTS,
	ITEM,
	MOTHERBOARD_SLOT,
	PATCH_PORTS,
	PROCESSORS,
	processorSlot,
	RACK_PREFAB,
	STATUS,
	type StatusName,
} from "./constants.ts";
import { RackHandle } from "./handle.ts";
import { PIN_NAMES, type PinName, RackDevice } from "./rack.ts";
import { SocketHousing } from "./socket.ts";

/** A chip in a socket: its key (`world.chip(key)`), and its program, `file` or `code`. */
export interface RackChip {
	key: string;
	/** Path to an `.ic10` file, relative to the world's `root`. */
	file?: string;
	/** Inline IC10 source. */
	code?: string;
}

/** The rack's switches, as `serverRack`'s options take them. */
export interface RackSwitchOptions {
	io: boolean;
	memWrite: boolean;
	remote: boolean;
	maint: boolean;
	turbo: boolean;
	clock: ClockSetting;
	/** The processor (1-12) the rack's LineNumber reads and writes. */
	prog: number;
	/** RUN per processor (index = processor − 1); left out: on. */
	run: readonly (boolean | undefined)[];
}

export interface RackOptions {
	/** Which device (by key) is on each pin, as `.housing()` takes them: it goes on the I/O port the pin's patch cable reaches. */
	pins?: Partial<Record<PinName, string>>;
	/** Patch cables moved from where they start (d0 → port 1 … d5 → port 6): a port 1-8, or null for unplugged. */
	patch?: Partial<Record<PinName, number | null>>;
	/** Devices on ports with no pin, by port 1-32 (9-32 exist only in software; scripts read their IDs from memory). */
	ports?: Partial<Record<number, string>>;
	/** The chips, by processor: index = processor − 1, holes for empty sockets. */
	chips?: readonly (RackChip | undefined)[];
	/** Bays (1-8) with a drive in them. Default: all 8. */
	drives?: readonly number[];
	/** Drive patch cables moved from where they start (bay n → bank n − 1): a bank 0-7, or null. */
	banks?: Partial<Record<number, number | null>>;
	/** Starting cells, by address. */
	memory?: Readonly<Record<number, number>>;
	/** Cells per drive: the mod's DriveCapacity setting (64-4096). Default 512. */
	driveCapacity?: number;
	switches?: Partial<RackSwitchOptions>;
	/** The BIOS's CPU multiplier. Default 1. */
	cpuMultiplier?: CpuMultiplier;
	/** The BIOS's "Scratch cells: read only". Default false. */
	scratchReadOnly?: boolean;
	/** Whether a system board is fitted. Default true; without one the rack doesn't start. */
	motherboard?: boolean;
	/**
	 * Whether chips run as soon as the rack starts (DIP 4 on). Default true: the world starts with
	 * the rack running, as when a save loads. False: they're held, at the start and after every
	 * power-up, until `serverRack.handle(world, key).start()`.
	 */
	autostart?: boolean;
	/** Status registers a test sets (the UPS, filter, clock…). */
	status?: Partial<Record<StatusName, number>>;
}

/** The core temperature a rack sits at in normal base air (°C), per its Stationpedia page. */
const IDLE_TEMPERATURE_C = 45;

/** What `layout` works out from the options. */
interface Layout {
	capacity: number;
	pinPatch: (number | null)[];
	portKeys: (string | undefined)[];
	bays: boolean[];
	bayBank: (number | null)[];
}

const isWhole = (value: unknown, min: number, max: number): value is number =>
	typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** Check the options and work out the patch field and drives; throws for a bad one. */
function layout(options: RackOptions, key: string): Layout {
	const fail = (message: string): never => {
		throw new Error(`server rack "${key}": ${message}`);
	};
	const capacity = options.driveCapacity ?? DEFAULT_DRIVE_CAPACITY;
	if (!isWhole(capacity, 64, 4096)) fail(`driveCapacity ${capacity}: the mod allows 64 to 4096`);

	const pinIndex = (pin: string, option: string): number => {
		const index = PIN_NAMES.indexOf(pin as PinName);
		return index >= 0 ? index : fail(`${option}: no pin "${pin}" (use d0–d5)`);
	};
	const pinPatch: (number | null)[] = PIN_NAMES.map((_, pin) => pin);
	for (const [pin, port] of Object.entries(options.patch ?? {})) {
		const index = pinIndex(pin, "patch");
		if (port === null) pinPatch[index] = null;
		else if (isWhole(port, 1, PATCH_PORTS)) pinPatch[index] = port - 1;
		else if (port !== undefined) fail(`patch.${pin}: ${port} isn't a patch-field port (1-${PATCH_PORTS}, or null)`);
	}

	const portKeys: (string | undefined)[] = Array.from({ length: IO_PORTS }, () => undefined);
	const place = (port: number, device: string, option: string) => {
		const there = portKeys[port];
		if (there !== undefined && there !== device) fail(`${option}: port ${port + 1} already has "${there}"`);
		portKeys[port] = device;
	};
	for (const [port, device] of Object.entries(options.ports ?? {})) {
		if (!isWhole(Number(port), 1, IO_PORTS)) fail(`ports: no port ${port} (use 1-${IO_PORTS})`);
		if (device !== undefined) place(Number(port) - 1, device, `ports.${port}`);
	}
	for (const [pin, device] of Object.entries(options.pins ?? {})) {
		const index = pinIndex(pin, "pins");
		if (device === undefined) continue;
		const port = pinPatch[index];
		if (port === null || port === undefined) fail(`pins.${pin}: its patch cable is unplugged ({ patch: { ${pin}: null } })`);
		place(port!, device, `pins.${pin}`);
	}

	const bays = Array.from({ length: DRIVE_BAYS }, () => options.drives === undefined);
	for (const bay of options.drives ?? []) {
		if (!isWhole(bay, 1, DRIVE_BAYS)) fail(`drives: no bay ${bay} (use 1-${DRIVE_BAYS})`);
		bays[bay - 1] = true;
	}
	const bayBank: (number | null)[] = Array.from({ length: DRIVE_BAYS }, (_, bay) => bay);
	for (const [bay, bank] of Object.entries(options.banks ?? {})) {
		if (!isWhole(Number(bay), 1, DRIVE_BAYS)) fail(`banks: no bay ${bay} (use 1-${DRIVE_BAYS})`);
		if (bank === null) bayBank[Number(bay) - 1] = null;
		else if (isWhole(bank, 0, DRIVE_BAYS - 1)) bayBank[Number(bay) - 1] = bank;
		else if (bank !== undefined) fail(`banks.${bay}: no bank ${bank} (use 0-${DRIVE_BAYS - 1}, or null)`);
	}
	bayBank.forEach((bank, bay) => {
		const other = bank === null ? -1 : bayBank.indexOf(bank);
		if (other >= 0 && other !== bay) fail(`banks: bays ${other + 1} and ${bay + 1} both go to bank ${bank}`);
	});

	const chips = options.chips ?? [];
	if (chips.length > PROCESSORS) fail(`chips: ${chips.length} chips, but the rack has ${PROCESSORS} sockets`);
	const chipKeys = new Set<string>();
	chips.forEach((chip, index) => {
		if (chip === undefined) return;
		if (typeof chip.key !== "string" || chip.key === "") fail(`chips[${index}]: needs a key`);
		if (chipKeys.has(chip.key)) fail(`chips: "${chip.key}" is in two sockets`);
		chipKeys.add(chip.key);
	});

	const switches = options.switches ?? {};
	if (switches.prog !== undefined && !isWhole(switches.prog, 1, PROCESSORS)) fail(`switches.prog: no processor ${switches.prog} (use 1-${PROCESSORS})`);
	if (switches.clock !== undefined && !Object.hasOwn(CLOCK_LINES, switches.clock)) fail(`switches.clock: "${switches.clock}" (use LO, MED, HI or MAX)`);
	if ((switches.run?.length ?? 0) > PROCESSORS) fail(`switches.run: ${switches.run!.length} entries, but the rack has ${PROCESSORS} processors`);
	if (options.cpuMultiplier !== undefined && ![0.5, 1, 2].includes(options.cpuMultiplier)) fail(`cpuMultiplier ${options.cpuMultiplier} (use 0.5, 1 or 2)`);
	for (const name of Object.keys(options.status ?? {})) {
		if (!Object.hasOwn(STATUS, name)) fail(`status: no status register "${name}" (use ${Object.keys(STATUS).join(", ")})`);
	}
	return { capacity, pinPatch, portKeys, bays, bayBank };
}

/** The DS-8 Server Rack, for `sim().add(key, serverRack, options)`. */
export const serverRack: DeviceKind<RackOptions> & {
	/** The rack's own controls in a built world: its memory, drives, patch field and switches. */
	handle(world: World, key: string): RackHandle;
} = {
	prefab: RACK_PREFAB,

	validate(options, { key, keys }) {
		const { portKeys } = layout(options, key);
		for (const device of portKeys) {
			if (device !== undefined && !keys.has(device)) throw new Error(`server rack "${key}": no device "${device}"`);
		}
	},

	create(context, options) {
		const plan = layout(options, context.key);
		const rack = new RackDevice({ id: context.id, hash: context.hash, name: context.name ?? context.prefab }, plan.capacity);
		plan.pinPatch.forEach((port, pin) => (rack.pinPatch[pin] = port));
		plan.portKeys.forEach((device, port) => {
			rack.ioKeys[port] = device;
			rack.ioDevices[port] = device === undefined ? 0 : context.idOf(device)!;
		});
		plan.bays.forEach((fitted, bay) => {
			if (!fitted) return;
			rack.bays[bay] = Array.from({ length: plan.capacity }, () => 0);
			rack.setSlotItem(bay, ITEM.drive);
		});
		plan.bayBank.forEach((bank, bay) => (rack.bayBank[bay] = bank));

		const { run, ...switches } = options.switches ?? {};
		Object.assign(rack.switches, switches);
		run?.forEach((on, index) => {
			if (on !== undefined) rack.switches.run[index] = on;
		});
		Object.assign(rack.status, options.status);
		rack.cpuMultiplier = options.cpuMultiplier ?? 1;
		rack.scratchReadOnly = options.scratchReadOnly ?? false;
		rack.motherboard = options.motherboard ?? true;
		if (rack.motherboard) rack.setSlotItem(MOTHERBOARD_SLOT, ITEM.motherboard);
		rack.autostart = options.autostart ?? true;
		rack.held.fill(!rack.autostart);

		// Switched on, at the temperature it sits at in a base: a test's props come after.
		rack.props?.forceWrite("On", 1);
		rack.props?.forceWrite("Temperature", IDLE_TEMPERATURE_C + 273.15);

		for (const [address, value] of Object.entries(options.memory ?? {})) {
			const cell = Number(address);
			const bank = Math.floor(cell / plan.capacity);
			const drive = Number.isInteger(cell) && cell >= 0 && cell < rack.size ? rack.bays[rack.bayBank.indexOf(bank)] : undefined;
			if (!drive) throw new Error(`server rack "${context.key}": memory ${address}: no drive is patched to bank ${bank} for that address`);
			drive[cell % plan.capacity] = value;
		}

		const chips: HostedChip[] = [];
		(options.chips ?? []).forEach((spec, index) => {
			if (spec === undefined) return;
			const program = context.program(spec, `chip "${spec.key}"`);
			const chip = new Chip({ id: 0, ic10Code: program.code, register_length: 18, stack_length: 512 });
			const socket = new SocketHousing({ id: context.nextId(), chip });
			socket.rack = rack;
			rack.sockets[index] = socket;
			rack.setSlotItem(processorSlot(index + 1), ITEM.chip);
			chips.push({
				key: spec.key,
				housing: socket,
				source: program.source,
				...(program.path !== undefined && { path: program.path }),
				pins: () => rack.pinKeys(),
				linesPerTick: () => rack.linesPerTick,
				powered: () => rack.checkPower(),
				held: () => !rack.switches.run[index] || rack.held[index]!,
				beforeStep: () => {
					rack.asking = index + 1;
				},
				afterStep: () => {
					rack.asking = 0;
					rack.syncProps();
				},
			});
		});
		rack.syncProps();
		return { device: rack, chips };
	},

	idle(file, stubs) {
		return { options: { pins: stubs.pins, chips: [{ key: "ic", file }] }, chip: "ic" };
	},

	handle(world, key) {
		return new RackHandle(world, key);
	},
};
