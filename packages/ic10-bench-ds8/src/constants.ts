/**
 * The DS-8 Server Rack's numbers, from the mod's own code (ServerRack.dll 5.12.2, decompiled) and
 * its Stationpedia page.
 */

export const RACK_PREFAB = "StructureServerRack";

/** Chip sockets, as processors 1-12. */
export const PROCESSORS = 12;

/** Processor n's slot: 1-4 on the front panel (slots 8-11), 5-12 in the rear chassis (13-20). */
export function processorSlot(processor: number): number {
	return processor <= 4 ? 7 + processor : 8 + processor;
}

/** Drive bays: slots 0-7, and as many banks of memory. */
export const DRIVE_BAYS = 8;
export const MOTHERBOARD_SLOT = 12;

/** Cells per drive: the mod's DriveCapacity setting, 512 unless a save changed it (64-4096). */
export const DEFAULT_DRIVE_CAPACITY = 512;

/** I/O ports: 1-8 on the patch field, 9-32 only in software. */
export const IO_PORTS = 32;
export const PATCH_PORTS = 8;

/** Status registers, above the drives' cells. */
export const STATUS_REGISTERS = 88;

/** Lines each processor runs per tick, by the CLOCK knob's position (TURBO doubles them). */
export const CLOCK_LINES = { LO: 32, MED: 64, HI: 128, MAX: 256 } as const;
export type ClockSetting = keyof typeof CLOCK_LINES;

/** The BIOS's processor speed setting (CPU multiplier). */
export type CpuMultiplier = 0.5 | 1 | 2;

/** A processor's state, as status registers 4116-4119 and 4152-4159 give it. */
export const CPU_STATE = { empty: 0, halted: 1, running: 2, error: 3, badCode: 4, step: 5 } as const;

/** The prefabs of what sits in the rack's slots. */
export const ITEM = {
	chip: "ItemIntegratedCircuit10",
	drive: "ItemServerDrive",
	motherboard: "MotherboardLogic",
} as const;

/**
 * Status registers a test can set, by name, as offsets above the drives (4096 + offset with
 * 512-cell drives). The ones the rack works out are left out: core temperature (from its
 * Temperature), power, drives and cells, counters, processors, ports and the asking processor.
 */
export const STATUS = {
	upsRatio: 2,
	onBattery: 3,
	filter: 4,
	fanMode: 5,
	activity: 6,
	uptime: 7,
	timeOfDay: 8,
	alarm: 9,
	operatingHours: 24,
	alarmTemperature: 25,
	hatchOpen: 26,
	batteryHealth: 28,
	mainsPresent: 29,
} as const;
export type StatusName = keyof typeof STATUS;

/** Starting values of the status registers a test can set: a healthy rack on mains. */
export const STATUS_DEFAULTS: Record<StatusName, number> = {
	upsRatio: 1,
	onBattery: 0,
	filter: 1,
	fanMode: 0,
	activity: 0,
	uptime: 0,
	timeOfDay: 0,
	alarm: 0,
	operatingHours: 0,
	alarmTemperature: 70,
	hatchOpen: 0,
	batteryHealth: 1,
	mainsPresent: 1,
};
