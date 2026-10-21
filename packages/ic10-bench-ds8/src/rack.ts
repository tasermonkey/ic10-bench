/**
 * The DS-8 Server Rack as the emulator sees it: a device with drives of memory, status registers,
 * 32 I/O ports, a patch field for its chips' pins, and the logic types its mod gives it. Each rule
 * here is the mod's own (ServerRack.cs in ServerRack.dll 5.12.2: ReadMemory, WriteMemory,
 * ClearMemory, SysRegister, GetLogicValue, SetLogicValue, GetLogicableFromIndex, StateOf).
 *
 * What isn't simulated: the rack's own automation (rules, scenes, programs, print jobs), its
 * screens and keys, heat, the air filter and the UPS. Status registers for those hold what a test
 * sets (see STATUS); the rack's Temperature, Charge and power readings are plain properties.
 */
import {
	type Device,
	type DeviceConstructor,
	ErrorSeverity,
	HashString,
	i18n,
	Ic10Error,
	ItemEntity,
	Logics,
	Network,
	type StackInterface,
	Structure,
} from "@tasermonkey/ic10";
import {
	type ClockSetting,
	CLOCK_LINES,
	CPU_STATE,
	type CpuMultiplier,
	DEFAULT_DRIVE_CAPACITY,
	DRIVE_BAYS,
	IO_PORTS,
	PATCH_PORTS,
	PROCESSORS,
	STATUS,
	STATUS_DEFAULTS,
	STATUS_REGISTERS,
	type StatusName,
} from "./constants.ts";
import type { SocketHousing } from "./socket.ts";

export type PinName = "d0" | "d1" | "d2" | "d3" | "d4" | "d5";
export const PIN_NAMES: readonly PinName[] = ["d0", "d1", "d2", "d3", "d4", "d5"];

/** The rack's switches that matter to its chips and memory. */
export interface RackSwitches {
	/** I/O: chips reach devices (pins, `ld`/`sd`, batch). Off, every pin is empty and batch fails. Default on. */
	io: boolean;
	/** MEM WR: the rack's own chips can write its drives. Default on. */
	memWrite: boolean;
	/** REM: chips elsewhere can write the rack's logic (Setting, Index, Mode, Lock, ClearMemory, LineNumber). Default on. */
	remote: boolean;
	/** MAINT, at the back: maintenance mode, which drops those writes too. Default off. */
	maint: boolean;
	/** TURBO: double clock. Default off. */
	turbo: boolean;
	/** CLOCK: lines per tick for each processor (LO 32, MED 64, HI 128, MAX 256). Default HI. */
	clock: ClockSetting;
	/** PROG: the processor (1-12) the rack's LineNumber reads and writes. Default 1. */
	prog: number;
	/** RUN, per processor (index = processor − 1). Off, it's halted where it is. Default all on. */
	run: boolean[];
}

export const DEFAULT_SWITCHES: Omit<RackSwitches, "run"> = {
	io: true,
	memWrite: true,
	remote: true,
	maint: false,
	turbo: false,
	clock: "HI",
	prog: 1,
};

/** Logic types the rack works out itself; the rest are plain properties. */
const READS = new Set(["Setting", "Index", "Mode", "Lock", "Quantity", "Maximum", "Ratio", "LineNumber", "StackSize"]);
/** Logic types the rack acts on when written; from outside it, only with REM on and MAINT off. */
const WRITES = new Set(["Setting", "Index", "Mode", "Lock", "ClearMemory", "LineNumber"]);

const nameOf = (prop: number | string): string => (typeof prop === "string" ? prop : String(Logics.getByValue(prop as never)));

function stackError(message: "stack_underflow" | "stack_overflow"): Ic10Error {
	return new Ic10Error({ message: i18n.t(`error.${message}`), severity: ErrorSeverity.Strong });
}

/**
 * The network a rack's chips see with the I/O switch off. In game a batch instruction then stops
 * the chip with DeviceListNull (in game, 2026-10-20). Its device list is empty, and listing it
 * while a chip runs a line throws that: the batch instructions list it (`Array.from`, by its
 * iterator), the emulator's per-line error sweep doesn't (`forEach`). `ld`/`sd` by ID find nothing.
 */
class IoOffNetwork extends Network {
	constructor(rack: { readonly asking: number }) {
		super();
		class NoDevices extends Set<Device> {
			override [Symbol.iterator](): SetIterator<Device> {
				if (rack.asking > 0) {
					throw new Ic10Error({ message: "DeviceListNull: no devices on the network (the rack's I/O switch is off)", severity: ErrorSeverity.Strong });
				}
				return super[Symbol.iterator]();
			}
		}
		Object.defineProperty(this, "devices", { value: new NoDevices() });
	}

	override deviceById(): Device | undefined {
		return undefined;
	}

	override devicesByHash(): Device[] {
		return Array.from(this.devices);
	}
}

export class RackDevice extends Structure {
	/** Cells per drive. */
	readonly capacity: number;
	/** Each bay's drive, by bay index (bay 1 is index 0): its cells, or undefined for an empty bay. */
	readonly bays: (number[] | undefined)[];
	/** The bank (0-7) each bay's patch cable goes to, or null for none. Bay n goes to bank n − 1 at first. */
	readonly bayBank: (number | null)[];
	/** Each I/O port's device (index = port − 1): its reference ID (0: none), and its test-side key. */
	readonly ioDevices: number[];
	readonly ioKeys: (string | undefined)[];
	/** Each pin's patch cable: the port index (0-7) it goes to, or null. d0-d5 go to ports 1-6 at first. */
	readonly pinPatch: (number | null)[];
	readonly switches: RackSwitches;
	/** Status registers a test can set. */
	readonly status: Record<StatusName, number>;
	/** The eight shared scratch cells. */
	readonly scratch: number[];
	/** The chip in each socket (index = processor − 1). */
	readonly sockets: (SocketHousing | undefined)[];
	/** Processors held after power-up (DIP 4 off), until started. */
	readonly held: boolean[];
	cpuMultiplier: CpuMultiplier = 1;
	/** The BIOS's "Scratch cells: read only". */
	scratchReadOnly = false;
	/** Whether a system board is fitted; without one the rack doesn't start. */
	motherboard = true;
	/** Overheated: off line until it cools (Error = 1). */
	overheated = false;
	/** Whether chips run as soon as the rack starts (DIP 4); otherwise they're held until started. */
	autostart = true;
	/** LOCK: write protection. */
	writeProtect = false;
	/** Index: the address pointer Setting reads and writes. */
	cursor = 0;
	/** Mode: the program on the screen, 0-12. */
	mode = 0;
	/** The processor (1-12) running the line in progress, or 0: status register 31. */
	asking = 0;
	reads = 0;
	writes = 0;
	faults = 0;
	private readonly rackMemory: RackMemory;
	/** What the rack's chips see as their network with I/O off: nothing, and batch instructions fail. */
	private readonly unplugged: Network = new IoOffNetwork(this);
	private wasOnline = true;

	constructor(args: DeviceConstructor, capacity = DEFAULT_DRIVE_CAPACITY) {
		super(args);
		this.capacity = capacity;
		this.bays = Array.from({ length: DRIVE_BAYS }, () => undefined);
		this.bayBank = Array.from({ length: DRIVE_BAYS }, (_, bay) => bay);
		this.ioDevices = Array.from({ length: IO_PORTS }, () => 0);
		this.ioKeys = Array.from({ length: IO_PORTS }, () => undefined);
		this.pinPatch = PIN_NAMES.map((_, pin) => pin);
		this.switches = { ...DEFAULT_SWITCHES, run: Array.from({ length: PROCESSORS }, () => true) };
		this.status = { ...STATUS_DEFAULTS };
		this.scratch = Array.from({ length: 8 }, () => 0);
		this.sockets = Array.from({ length: PROCESSORS }, () => undefined);
		this.held = Array.from({ length: PROCESSORS }, () => false);
		this.rackMemory = new RackMemory(this);
		this.installLogic();
	}

	override get memory(): StackInterface | undefined {
		return this.rackMemory ?? super.memory;
	}

	override get hasMemory(): boolean {
		return true;
	}

	/** Cells on the drives together: 8 × the drive capacity. Status registers start here. */
	get size(): number {
		return this.capacity * DRIVE_BAYS;
	}

	/** Switched on with a system board: the processors can run, and the status registers answer. */
	get running(): boolean {
		return this.motherboard && (this.props?.forceRead("On") ?? 0) !== 0;
	}

	/** Running and not overheated: the drives answer. */
	get online(): boolean {
		return this.running && !this.overheated;
	}

	/** The network the rack's chips see: the rack's own, or none with I/O off. */
	get chipNetwork(): Network {
		return this.switches.io ? this.network : this.unplugged;
	}

	// --- chips ---------------------------------------------------------------------------------

	/** The device on a chip's pin (0-5) now: through its patch cable to a port, then by ID on the network. */
	pinDevice(pin: number): Device | undefined {
		if (!this.switches.io) return undefined;
		const port = this.pinPatch[pin];
		if (port === null || port === undefined || port >= PATCH_PORTS) return undefined;
		const id = this.ioDevices[port]!;
		return id === 0 ? undefined : this.network.deviceById(id);
	}

	/** Which device (by key) is on each pin now. */
	pinKeys(): Partial<Record<PinName, string>> {
		const out: Partial<Record<PinName, string>> = {};
		PIN_NAMES.forEach((name, pin) => {
			const port = this.pinPatch[pin];
			const key = port === null || port === undefined ? undefined : this.ioKeys[port];
			if (key !== undefined && this.pinDevice(pin)) out[name] = key;
		});
		return out;
	}

	/** Lines each processor runs per tick: CLOCK, TURBO and the BIOS multiplier. */
	get linesPerTick(): number {
		return Math.max(1, Math.floor(CLOCK_LINES[this.switches.clock] * (this.switches.turbo ? 2 : 1) * this.cpuMultiplier));
	}

	/**
	 * Whether processors have power now. When the rack starts again (or for the first time, with
	 * `autostart` off) it holds every processor until it's started, as with DIP 4 off.
	 */
	checkPower(): boolean {
		const online = this.online;
		if (online && !this.wasOnline && !this.autostart) this.held.fill(true);
		this.wasOnline = online;
		return online;
	}

	/** A processor's state (index = processor − 1), as status registers give it. */
	processorState(index: number): number {
		const socket = this.sockets[index];
		if (!socket) return CPU_STATE.empty;
		if ((socket.props?.forceRead("Error") ?? 0) !== 0) return CPU_STATE.error;
		if (!this.online || !this.switches.run[index] || this.held[index]) return CPU_STATE.halted;
		return CPU_STATE.running;
	}

	/** A processor's line (index = processor − 1), or -1 with no chip. */
	processorLine(index: number): number {
		const socket = this.sockets[index];
		return socket ? (socket.props?.forceRead("LineNumber") ?? 0) : -1;
	}

	// --- memory --------------------------------------------------------------------------------

	private bankDrive(bank: number): number[] | undefined {
		const bay = this.bayBank.indexOf(bank);
		return bay >= 0 ? this.bays[bay] : undefined;
	}

	/** `get`: a drive's cell, or a status register above them. */
	readMemory(address: number): number {
		if (address < 0) throw stackError("stack_underflow");
		if (address >= this.size) {
			if (address >= this.size + STATUS_REGISTERS) throw stackError("stack_overflow");
			return this.running ? this.statusRegister(address - this.size) : 0;
		}
		const drive = this.online ? this.bankDrive(Math.floor(address / this.capacity)) : undefined;
		if (!drive) {
			this.faults++;
			return 0;
		}
		this.reads++;
		return drive[address % this.capacity] ?? 0;
	}

	/** `put`: a drive's cell or a scratch cell; anything else counts a fault and changes nothing. */
	writeMemory(address: number, value: number): void {
		if (address < 0) throw stackError("stack_underflow");
		if (address >= this.size) {
			const register = address - this.size;
			if (register >= STATUS_REGISTERS) throw stackError("stack_overflow");
			if (register >= 40 && register < 48 && this.running && !this.scratchReadOnly) this.scratch[register - 40] = value;
			else this.faults++;
		} else if (this.asking > 0 && !this.switches.memWrite) {
			this.faults++;
		} else {
			this.tryWrite(address, value);
		}
		this.syncProps();
	}

	private tryWrite(address: number, value: number): boolean {
		const drive = this.online && !this.writeProtect && address >= 0 && address < this.size ? this.bankDrive(Math.floor(address / this.capacity)) : undefined;
		if (!drive) {
			this.faults++;
			return false;
		}
		drive[address % this.capacity] = value;
		this.writes++;
		return true;
	}

	/** `clr` and ClearMemory: format every drive. */
	clearMemory(): void {
		if (!this.online || this.writeProtect) {
			this.faults++;
			return;
		}
		for (const drive of this.bays) drive?.fill(0);
		this.writes++;
		this.syncProps();
	}

	/** A cell or status register as it is, without the rules or counters (for tests and reports). */
	peek(address: number): number {
		if (address >= this.size) return address < this.size + STATUS_REGISTERS ? this.statusRegister(address - this.size) : 0;
		return this.bankDrive(Math.floor(address / this.capacity))?.[address % this.capacity] ?? 0;
	}

	/** Cells on patched drives that aren't 0. */
	usedCells(): number {
		let used = 0;
		for (let bank = 0; bank < DRIVE_BAYS; bank++) for (const cell of this.bankDrive(bank) ?? []) if (cell !== 0) used++;
		return used;
	}

	/** Cells on patched drives, while the rack is on line. */
	onlineCapacity(): number {
		if (!this.online) return 0;
		let cells = 0;
		for (let bank = 0; bank < DRIVE_BAYS; bank++) if (this.bankDrive(bank)) cells += this.capacity;
		return cells;
	}

	statusRegister(register: number): number {
		if (register >= 64) return this.ioDevices[8 + register - 64]!;
		if (register >= 56) return this.processorState(4 + register - 56);
		if (register >= 48) return this.processorLine(4 + register - 48);
		if (register >= 40) return this.scratch[register - 40]!;
		if (register >= 32) return this.ioDevices[register - 32]!;
		if (register >= 20 && register <= 23) return this.processorState(register - 20);
		if (register >= 16 && register <= 19) return this.processorLine(register - 16);
		switch (register) {
			case 0:
				return (this.props?.forceRead("Temperature") ?? 0) - 273.15;
			case 1:
				return this.running ? (this.props?.forceRead("PowerActual") ?? 0) : 0;
			case 10:
				return Array.from({ length: DRIVE_BAYS }, (_, bank) => this.bankDrive(bank)).filter(Boolean).length;
			case 11:
				return this.usedCells();
			case 12:
				return this.onlineCapacity();
			case 13:
				return this.reads;
			case 14:
				return this.writes;
			case 15:
				return this.faults;
			case 27:
				return this.writeProtect ? 1 : 0;
			case 30:
				return this.switches.maint ? 1 : 0;
			case 31:
				return this.asking;
		}
		const named = (Object.entries(STATUS) as [StatusName, number][]).find(([, offset]) => offset === register);
		return named ? this.status[named[0]] : 0;
	}

	// --- logic ---------------------------------------------------------------------------------

	private installLogic(): void {
		const props = this.props!;
		// The rack's other logic types (On, Temperature, Charge, power…) are plain properties.
		const direct = <T>(run: () => T): T => {
			const hooks = props.hooks;
			props.hooks = undefined;
			try {
				return run();
			} finally {
				props.hooks = hooks;
			}
		};
		props.hooks = {
			canLoad: (prop) => READS.has(nameOf(prop)) || direct(() => props.canLoad(prop)),
			canStore: (prop) => WRITES.has(nameOf(prop)) || direct(() => props.canStore(prop)),
			read: (prop) => this.readLogic(nameOf(prop)) ?? direct(() => props.read(prop)),
			write: (prop, value) => {
				if (!this.writeLogic(nameOf(prop), value)) direct(() => props.write(prop, value));
				this.syncProps();
			},
		};
	}

	private readLogic(name: string): number | undefined {
		switch (name) {
			case "Setting":
				return this.peek(this.cursor);
			case "Index":
				return this.cursor;
			case "Mode":
				return this.mode;
			case "Lock":
				return this.writeProtect ? 1 : 0;
			case "Quantity":
				return this.usedCells();
			case "Maximum":
				return this.onlineCapacity();
			case "Ratio": {
				const capacity = this.onlineCapacity();
				return capacity > 0 ? this.usedCells() / capacity : 0;
			}
			case "LineNumber":
				return this.processorLine(this.switches.prog - 1);
			case "StackSize":
				return this.size;
		}
		return undefined;
	}

	/** A write the rack acts on; false for one that's a plain property. */
	private writeLogic(name: string, value: number): boolean {
		if (!WRITES.has(name)) return false;
		if (this.asking === 0 && (!this.switches.remote || this.switches.maint)) {
			this.faults++;
			return true;
		}
		if (Number.isNaN(value) && name !== "Setting" && name !== "ClearMemory") return true;
		switch (name) {
			case "LineNumber": {
				const socket = this.sockets[this.switches.prog - 1];
				socket?.runner?.context.setNextLineIndex(Math.trunc(value));
				break;
			}
			case "Setting":
				this.tryWrite(this.cursor, value);
				break;
			case "Index": {
				const address = Math.round(Math.max(-1e9, Math.min(1e9, value))) % this.size;
				this.cursor = address < 0 ? address + this.size : address;
				break;
			}
			case "Mode":
				this.mode = Math.max(0, Math.min(12, Math.round(value)));
				break;
			case "Lock":
				this.writeProtect = value >= 0.5;
				break;
			case "ClearMemory":
				if (value >= 0.5) this.clearMemory();
				break;
		}
		return true;
	}

	/**
	 * Keep the rack's own properties as its logic reads them, so a test reading the device (and the
	 * debugger) sees what a chip would: the rack works them out from its memory and processors.
	 */
	syncProps(): void {
		const props = this.props;
		if (!props) return;
		for (const name of READS) {
			if (name === "StackSize" || !this.hasLogic(name)) continue;
			props.forceWrite(name, this.readLogic(name)!);
		}
		if (this.hasLogic("Error")) props.forceWrite("Error", this.overheated ? 1 : 0);
	}

	private hasLogic(name: string): boolean {
		return (this.rawData?.logics ?? []).some((logic) => logic.name === name);
	}

	/** Put an item in a slot as the game shows it there (`ls` sees it), or empty the slot. */
	setSlotItem(slot: number, prefab: string | undefined): void {
		const place = this.slots?.getSlot(slot);
		if (!place) return;
		if (prefab === undefined) {
			place.removeItem();
			return;
		}
		const item = new ItemEntity(new HashString(prefab).hash, 1);
		item.setProp("Occupied", 1);
		item.setProp("OccupantHash", item.hash);
		place.putItem(item, true);
	}
}

/** The rack's memory as the emulator asks for it: `get`, `put` and `clr` on the rack. */
class RackMemory implements StackInterface {
	private readonly rack: RackDevice;

	constructor(rack: RackDevice) {
		this.rack = rack;
	}

	get(index: number): number {
		return this.rack.readMemory(index);
	}

	set(index: number, value: number): void {
		this.rack.writeMemory(index, value);
	}

	delete(index: number): void {
		this.rack.writeMemory(index, 0);
	}

	push(): void {
		throw new Error("the rack's memory has no stack pointer");
	}

	pop(): number {
		throw new Error("the rack's memory has no stack pointer");
	}

	reset(): void {
		this.rack.clearMemory();
	}

	get length(): number {
		return this.rack.size;
	}

	toArray(): number[] {
		const cells = Array.from({ length: this.rack.size }, (_, address) => this.rack.peek(address));
		let end = cells.length;
		while (end > 0 && cells[end - 1] === 0) end--;
		return cells.slice(0, end);
	}
}
