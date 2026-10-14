import type { Device } from "@tasermonkey/ic10";
import type { Mixture, Reservoir } from "../../atmos/mixture.ts";
import {
	clearSlot,
	listProps,
	putItem,
	readProp,
	readSlot,
	slotOccupied,
	writeProp,
	writeSlot,
} from "../../engine/device.ts";
import { formatId } from "../../engine/ids.ts";
import type { LogicMirror } from "../../engine/mirror.ts";
import { type Attachments, applyReadings, type Port, type Reading } from "../atmospheres.ts";
import type { World } from "../world.ts";

export interface DeviceEntry {
	key: string;
	device: Device;
	prefab: string;
	network: string;
	/** The pipes and room it's attached to. */
	attached?: Attachments;
	/** What it reads from them, refreshed every tick. */
	readings?: Reading[];
}

/** A device in the world (a housing too), found by its test-side key. */
export class DeviceHandle {
	/** The world the device is in. */
	readonly world: World;
	private readonly entry: DeviceEntry;

	constructor(world: World, entry: DeviceEntry) {
		this.world = world;
		this.entry = entry;
	}

	/** Test-side key, e.g. `"vent"`. */
	get key(): string {
		return this.entry.key;
	}

	/** Reference ID (what `ld` / `sd` use). */
	get id(): number {
		return this.entry.device.id;
	}

	/** Reference ID as the game shows it, e.g. `$1488`. */
	get idHex(): string {
		return formatId(this.id);
	}

	get prefab(): string {
		return this.entry.prefab;
	}

	/** In-game name (what `lbn` / `sbn` match). Defaults to the prefab name, as in game. */
	get name(): string {
		return this.entry.device.name.toString();
	}

	/** Id of the data network it's on. */
	get network(): string {
		return this.entry.network;
	}

	/** The emulator's device, for anything the handle doesn't cover. */
	get raw(): Device {
		return this.entry.device;
	}

	/** A logic property's value (0 when unset). Throws if the device has no such property. */
	get(prop: string): number {
		return readProp(this.entry.device, prop);
	}

	/**
	 * Set a logic property, read-only ones included, as the game does when it updates readings.
	 * Throws for a reading that comes from an attached pipe or room: change the gas there instead.
	 */
	set(prop: string, value: number): this {
		const reading = this.entry.readings?.find((r) => r.prop === prop);
		if (reading) {
			const { kind, key } = reading.source;
			throw new Error(
				`"${this.key}".${prop} comes from ${kind} "${key}", so it can't be set on the device; change world.${kind}("${key}") instead`,
			);
		}
		writeProp(this.entry.device, prop, value);
		return this;
	}

	/** The pipe it sits on (`{ pipe }`), or undefined. */
	get pipe(): Mixture | undefined {
		return this.entry.attached?.pipe?.atmosphere as Mixture | undefined;
	}

	/** The room it's in (`{ room }`), or undefined. */
	get room(): Mixture | Reservoir | undefined {
		return this.entry.attached?.room?.atmosphere;
	}

	/** The pipe on one of its ports (`{ ports }`), or undefined. */
	port(port: Port): Mixture | undefined {
		return this.entry.attached?.ports[port]?.atmosphere as Mixture | undefined;
	}

	/** Properties that come from its pipes and room, which `set` refuses. */
	get readings(): string[] {
		return (this.entry.readings ?? []).map((r) => r.prop);
	}

	/** @internal Update its readings from its pipes and room. */
	refreshReadings(): void {
		if (this.entry.readings) applyReadings(this.entry.device, this.entry.readings);
	}

	/** Add to a logic property. */
	add(prop: string, delta: number): this {
		return this.set(prop, this.get(prop) + delta);
	}

	/** The named properties' values, or every property with a value if no names are given. */
	props(...names: string[]): Record<string, number> {
		if (names.length === 0) return listProps(this.entry.device);
		return Object.fromEntries(names.map((name) => [name, this.get(name)]));
	}

	/**
	 * An entry in the device's own memory, which `put` / `get` on a pin write and read (a logic
	 * sorter's instructions, say). Throws if the device has no memory. For a housing's chip, use
	 * `world.chip(key).stackAt(i)`.
	 */
	stackAt(index: number): number {
		const memory = this.entry.device.hasMemory ? this.entry.device.memory : undefined;
		if (!memory) throw new Error(`${this.prefab} "${this.key}" has no memory`);
		return memory.get(index) ?? 0;
	}

	/** One of the device's slots, for `ls` / `ss`. Throws if the device has no such slot. */
	slot(index: number): SlotHandle {
		return new SlotHandle(this.entry.device, index);
	}
}

/**
 * A Logic Mirror (`sim().mirror()`). It has no logic values of its own to get or set: chips read
 * and write its target through it, so read the target's handle instead.
 */
export class MirrorHandle extends DeviceHandle {
	private get mirror(): LogicMirror {
		return this.raw as LogicMirror;
	}

	/** The device it stands in for, or undefined. */
	get target(): DeviceHandle | undefined {
		const target = this.mirror.target;
		return target && this.world.deviceById(target.id);
	}

	/** Point it at another device, by key, as a screwdriver does in game; undefined for none. */
	setTarget(key: string | undefined): this {
		this.mirror.target = key === undefined ? undefined : this.world.device(key).raw;
		return this;
	}

	get powered(): boolean {
		return this.mirror.powered;
	}

	/** Power it or cut its power. Unpowered, reads through it are 0 and writes are dropped. */
	setPowered(powered: boolean): this {
		this.mirror.powered = powered;
		return this;
	}

	override get(prop: string): number {
		throw new Error(this.ownValues(prop));
	}

	override set(prop: string, _value: number): this {
		throw new Error(this.ownValues(prop));
	}

	private ownValues(prop: string): string {
		const target = this.target;
		const instead = target ? `; use world.device("${target.key}").${prop}` : "";
		return `"${this.key}" is a Logic Mirror: it has no ${prop} of its own${instead}`;
	}
}

/** A device's slot, and the item in it. */
export class SlotHandle {
	private readonly device: Device;
	readonly index: number;

	constructor(device: Device, index: number) {
		slotOccupied(device, index); // throws if there's no such slot
		this.device = device;
		this.index = index;
	}

	/** Whether there's an item in the slot. */
	get occupied(): boolean {
		return slotOccupied(this.device, this.index);
	}

	/**
	 * Put an item (by prefab name) in the slot, replacing what's there. Sets `Occupied`, `OccupantHash`
	 * and `Quantity` (default 1) as the game does; `props` sets those and other slot values.
	 */
	put(item: string, props: Record<string, number> = {}): this {
		putItem(this.device, this.index, item, props);
		return this;
	}

	/** Empty the slot. Its values then read 0. */
	clear(): this {
		clearSlot(this.device, this.index);
		return this;
	}

	/** A slot value as `ls` reads it (0 for an empty slot). */
	get(prop: string): number {
		return readSlot(this.device, this.index, prop);
	}

	/** Set a value on the item in the slot. Throws if the slot is empty. */
	set(prop: string, value: number): this {
		writeSlot(this.device, this.index, prop, value);
		return this;
	}
}
