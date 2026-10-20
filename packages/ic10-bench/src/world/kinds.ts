/**
 * Device kinds: a device the harness doesn't know, built by an extension package and added to a
 * world with `SimBuilder.add(key, kind, options)`. A kind makes the emulator device itself, and may
 * host chips of its own, each in a housing whose `db` is the kind's device. Nothing here knows any
 * particular kind; the extension does.
 */
import type { Device, Housing } from "@tasermonkey/ic10";
import type { Pin } from "./sim.ts";

/** What a kind's `create` is given: its device's place in the world, and a few services. */
export interface KindContext {
	/** The device's test-side key. */
	readonly key: string;
	/** Its reference ID, for the device the kind makes. */
	readonly id: number;
	/** Its prefab name, and the prefab's hash. The prefab is registered with the emulator already. */
	readonly prefab: string;
	readonly hash: number;
	/** In-game name, if the test gave one. */
	readonly name?: string;
	/** Another device's reference ID, by its key; undefined for a key the world doesn't have. */
	idOf(key: string): number | undefined;
	/** A program: `file` (relative to the world's root) or inline `code`, exactly one. `what` names it in errors. */
	program(source: { file?: string; code?: string }, what: string): HostedProgram;
	/** A reference ID no device in the world has, for a hosted chip's housing. */
	nextId(): number;
}

/** A program's text, and where it came from. */
export interface HostedProgram {
	code: string;
	/** The file as the test gave it, or `<code>`. */
	source: string;
	/** Absolute path of the file, or undefined for inline code. */
	path?: string;
}

/**
 * A chip a kind's device hosts. Its `housing` holds the chip, and answers `db` (pin -1 in
 * `getConnectedDevices`) with the host device. It isn't on any network itself.
 */
export interface HostedChip {
	/** The chip's test-side key: `world.chip(key)`. Can't be a device's key. */
	key: string;
	housing: Housing;
	/** Where the program came from, as `KindContext.program` gave it. */
	source: string;
	path?: string;
	/** Which device (by key) is on each pin now, for the debugger and reports. Default: none. */
	pins?(): Partial<Record<Pin, string>>;
	/** Lines the chip may run in a turn, asked at the start of each. Default: the world's. */
	linesPerTick?(): number;
	/**
	 * Whether the chip has power, asked at the start of each turn, like a housing's `On`: unpowered,
	 * it's skipped, and when power comes back it restarts from line 0. Default: always.
	 */
	powered?(): boolean;
	/** Whether to skip this turn and carry on later where it was, asked at the start of each turn. Default: never. */
	held?(): boolean;
	/** Called before each line the chip runs, and after: the host knows which chip is asking. */
	beforeStep?(): void;
	afterStep?(): void;
}

/** What a kind's `create` returns. */
export interface KindDevice {
	/** The device, not yet on a network: the harness puts it on its network and gives it its `props`. */
	device: Device;
	/** The chips it hosts, in the order they run. */
	chips?: HostedChip[];
}

/** Stand-in devices for the `idle` check, by key: one for each pin. */
export interface IdleStubs {
	pins: Record<Pin, string>;
}

/**
 * A device an extension adds: `sim().add(key, kind, options)`. `O` is the kind's own options.
 */
export interface DeviceKind<O> {
	/** Its prefab: one in the project's catalogue, as from `ic10-mods/`. */
	readonly prefab: string;
	/** Check the options before anything is built; `keys` are every key in the world. Throw to refuse. */
	validate?(options: O, world: { key: string; keys: ReadonlySet<string> }): void;
	create(context: KindContext, options: O): KindDevice;
	/**
	 * For the `idle` check of a script that says it runs in this kind (`"host"` in its `.json`):
	 * the options to run it with, and which of the kind's chips runs it. `stubs` are stand-ins the
	 * world already has.
	 */
	idle?(file: string, stubs: IdleStubs): { options: O; chip: string };
}
