/**
 * A rack's own controls in a built world, beyond what IC10 Bench's `DeviceHandle` reaches: its
 * memory with the status registers, its drives, the patch field, the I/O ports, its switches and
 * its processors. `serverRack.handle(world, key)` makes one.
 */
import type { DeviceHandle, World } from "@tasermonkey/ic10-bench";
import { CPU_STATE, DRIVE_BAYS, IO_PORTS, ITEM, PATCH_PORTS, PROCESSORS, type StatusName } from "./constants.ts";
import { PIN_NAMES, type PinName, RackDevice, type RackSwitches } from "./rack.ts";

/** A processor's state by name. */
export type ProcessorState = keyof typeof CPU_STATE;

export class RackHandle {
	readonly world: World;
	readonly key: string;
	private readonly rack: RackDevice;

	constructor(world: World, key: string) {
		const device = world.device(key);
		if (!(device.raw instanceof RackDevice)) throw new Error(`"${key}" is a ${device.prefab} built some other way, not by serverRack`);
		this.world = world;
		this.key = key;
		this.rack = device.raw;
	}

	/** The rack as IC10 Bench sees it: its logic properties, slots and network. */
	get device(): DeviceHandle {
		return this.world.device(this.key);
	}

	// --- memory --------------------------------------------------------------------------------

	/** Cells on the drives together (8 × the drive capacity); the status registers start here. */
	get size(): number {
		return this.rack.size;
	}

	/** A cell, or a status register above the drives, as it is: no faults or read counts. */
	memory(address: number): number {
		return this.rack.peek(address);
	}

	/** Set a cell on whichever drive is patched to its bank, whatever the switches say. */
	setMemory(address: number, value: number): this {
		const drive = this.driveAt(address);
		drive[address % this.rack.capacity] = value;
		this.rack.syncProps();
		return this;
	}

	/** A bay's (1-8) drive's cells, or undefined for an empty bay. */
	drive(bay: number): number[] | undefined {
		return this.rack.bays[this.bayIndex(bay)]?.slice();
	}

	/** Slide a drive into a bay (1-8), blank or with `cells`. */
	insertDrive(bay: number, cells: readonly number[] = []): this {
		const index = this.bayIndex(bay);
		if (this.rack.bays[index]) throw new Error(`rack "${this.key}": bay ${bay} already has a drive`);
		this.rack.bays[index] = Array.from({ length: this.rack.capacity }, (_, i) => cells[i] ?? 0);
		this.rack.setSlotItem(index, ITEM.drive);
		this.rack.syncProps();
		return this;
	}

	/** Pull a bay's (1-8) drive out; its cells go with it. Returns them. */
	removeDrive(bay: number): number[] {
		const index = this.bayIndex(bay);
		const cells = this.rack.bays[index];
		if (!cells) throw new Error(`rack "${this.key}": bay ${bay} has no drive`);
		this.rack.bays[index] = undefined;
		this.rack.setSlotItem(index, undefined);
		this.rack.syncProps();
		return cells;
	}

	/** Move a bay's (1-8) patch cable to a bank (0-7), or unplug it (null). */
	bank(bay: number, bank: number | null): this {
		const index = this.bayIndex(bay);
		if (bank !== null) {
			if (!Number.isInteger(bank) || bank < 0 || bank >= DRIVE_BAYS) throw new Error(`rack "${this.key}": no bank ${bank} (use 0-${DRIVE_BAYS - 1})`);
			const other = this.rack.bayBank.indexOf(bank);
			if (other >= 0 && other !== index) throw new Error(`rack "${this.key}": bank ${bank} has bay ${other + 1}'s cable`);
		}
		this.rack.bayBank[index] = bank;
		this.rack.syncProps();
		return this;
	}

	get reads(): number {
		return this.rack.reads;
	}

	get writes(): number {
		return this.rack.writes;
	}

	/** Reads and writes refused: a missing drive, write protection, MEM WR, a status register. */
	get faults(): number {
		return this.rack.faults;
	}

	// --- patch field and ports -----------------------------------------------------------------

	/** Move a pin's patch cable to a port (1-8), or unplug it (null). */
	patch(pin: PinName, port: number | null): this {
		const index = this.pinIndex(pin);
		if (port !== null && !(Number.isInteger(port) && port >= 1 && port <= PATCH_PORTS)) {
			throw new Error(`rack "${this.key}": ${pin} can only be patched to ports 1-${PATCH_PORTS}`);
		}
		this.rack.pinPatch[index] = port === null ? null : port - 1;
		return this;
	}

	/** The port (1-8) a pin's cable goes to, or null. */
	patchOf(pin: PinName): number | null {
		const port = this.rack.pinPatch[this.pinIndex(pin)];
		return port === null || port === undefined ? null : port + 1;
	}

	/** Put a device (by key) on a port (1-32), or empty it (null). */
	port(port: number, device: string | null): this {
		if (!(Number.isInteger(port) && port >= 1 && port <= IO_PORTS)) throw new Error(`rack "${this.key}": no port ${port} (use 1-${IO_PORTS})`);
		this.rack.ioDevices[port - 1] = device === null ? 0 : this.world.device(device).id;
		this.rack.ioKeys[port - 1] = device ?? undefined;
		return this;
	}

	/** The device (by key) on a port (1-32), or undefined. */
	portDevice(port: number): string | undefined {
		return this.rack.ioKeys[port - 1];
	}

	/**
	 * Make a device a pin for every processor, as the Network program's "pins in one key" does: it
	 * goes on the port the pin's cable reaches, and a pin with no cable gets the first free port
	 * (1-8). The device leaves any other port.
	 */
	assignPin(pin: PinName, device: string): this {
		const index = this.pinIndex(pin);
		const id = this.world.device(device).id;
		let port = this.rack.pinPatch[index] ?? null;
		if (port === null) {
			const cabled = new Set(this.rack.pinPatch.filter((p): p is number => p !== null));
			const free = Array.from({ length: PATCH_PORTS }, (_, p) => p).filter((p) => !cabled.has(p));
			port = free.find((p) => this.rack.ioDevices[p] === 0 || this.rack.ioDevices[p] === id) ?? free[0] ?? null;
			if (port === null) throw new Error(`rack "${this.key}": all ${PATCH_PORTS} patchable I/O ports are in use`);
			this.rack.pinPatch[index] = port;
		}
		this.rack.ioDevices.forEach((other, p) => {
			if (p !== port && other === id) {
				this.rack.ioDevices[p] = 0;
				this.rack.ioKeys[p] = undefined;
			}
		});
		this.rack.ioDevices[port] = id;
		this.rack.ioKeys[port] = device;
		return this;
	}

	// --- switches and processors ---------------------------------------------------------------

	/** Set one of the rack's switches (RUN per processor is `run()`). */
	setSwitch<K extends Exclude<keyof RackSwitches, "run">>(name: K, value: RackSwitches[K]): this {
		this.rack.switches[name] = value;
		this.rack.syncProps();
		return this;
	}

	get switches(): Readonly<RackSwitches> {
		return this.rack.switches;
	}

	/** Flip a processor's (1-12) RUN switch. */
	run(processor: number, on: boolean): this {
		this.rack.switches.run[this.processorIndex(processor)] = on;
		return this;
	}

	/** Start processors held since power-up (`autostart: false`). */
	start(): this {
		this.rack.held.fill(false);
		return this;
	}

	/** A processor's (1-12) state and line, as the status registers give them, and its chip's key. */
	processor(processor: number): { state: ProcessorState; line: number } {
		const index = this.processorIndex(processor);
		const code = this.rack.processorState(index);
		const state = (Object.entries(CPU_STATE) as [ProcessorState, number][]).find(([, value]) => value === code)![0];
		return { state, line: this.rack.processorLine(index) };
	}

	/** Set a status register the rack doesn't work out itself (the UPS, filter, clock…). */
	setStatus(name: StatusName, value: number): this {
		this.rack.status[name] = value;
		return this;
	}

	/** Overheat the rack (Error = 1): its drives go off line until it's cooled. */
	overheat(on = true): this {
		this.rack.overheated = on;
		this.rack.syncProps();
		return this;
	}

	/** Fit or pull the system board; without one the rack doesn't start. */
	motherboard(fitted: boolean): this {
		this.rack.motherboard = fitted;
		this.rack.setSlotItem(12, fitted ? ITEM.motherboard : undefined);
		this.rack.syncProps();
		return this;
	}

	// --- helpers -------------------------------------------------------------------------------

	private driveAt(address: number): number[] {
		const capacity = this.rack.capacity;
		if (!(Number.isInteger(address) && address >= 0 && address < this.rack.size)) {
			throw new Error(`rack "${this.key}": ${address} isn't a drive's cell (0-${this.rack.size - 1})`);
		}
		const bank = Math.floor(address / capacity);
		const drive = this.rack.bays[this.rack.bayBank.indexOf(bank)];
		if (!drive) throw new Error(`rack "${this.key}": no drive is patched to bank ${bank}`);
		return drive;
	}

	private bayIndex(bay: number): number {
		if (!(Number.isInteger(bay) && bay >= 1 && bay <= DRIVE_BAYS)) throw new Error(`rack "${this.key}": no bay ${bay} (use 1-${DRIVE_BAYS})`);
		return bay - 1;
	}

	private pinIndex(pin: PinName): number {
		const index = PIN_NAMES.indexOf(pin);
		if (index < 0) throw new Error(`rack "${this.key}": no pin "${pin}" (use d0–d5)`);
		return index;
	}

	private processorIndex(processor: number): number {
		if (!(Number.isInteger(processor) && processor >= 1 && processor <= PROCESSORS)) {
			throw new Error(`rack "${this.key}": no processor ${processor} (use 1-${PROCESSORS})`);
		}
		return processor - 1;
	}
}
