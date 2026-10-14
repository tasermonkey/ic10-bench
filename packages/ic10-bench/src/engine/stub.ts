/**
 * Stand-ins for the devices a script expects, for a run with nothing real connected (the `idle`
 * check): a device that has every logic type and every slot, all reading 0, and a housing that
 * answers the logic types of whatever device the chip was meant to sit in.
 */
import { type Device, type DeviceSlots, HashString, type Housing, Logics, LogicSlot, Slot, Structure } from "@tasermonkey/ic10";

/** The prefab name a stub reports. Not registered with the emulator, so batch instructions never find one. */
export const STUB_PREFAB = "IC10BenchStub";

type SlotDef = ConstructorParameters<typeof Slot>[1];

const EVERY_SLOT_LOGIC = [...LogicSlot].map(([name]) => name as string);

/**
 * A device the emulator has no data for, so it has every logic type, readable and writable, and
 * reads 0 for any it hasn't been given. Any slot index exists and is empty, so `ls` reads 0.
 */
export class StubDevice extends Structure {
	readonly #slots = new Map<number, Slot>();
	readonly #slotTable: DeviceSlots;

	constructor(id: number) {
		const prefabName = new HashString(STUB_PREFAB);
		super({ id, hash: prefabName.hash, name: STUB_PREFAB });
		Object.defineProperty(this, "prefabName", { value: prefabName });
		this.errors.reset(); // the emulator's "unknown device" warnings
		this.#slotTable = { getSlot: (index: number) => this.#slot(index) } as unknown as DeviceSlots;
	}

	#slot(index: number): Slot | undefined {
		if (!Number.isInteger(index) || index < 0) return undefined;
		let slot = this.#slots.get(index);
		if (!slot) {
			const def = { SlotIndex: index, SlotName: `Slot ${index}`, SlotType: "None", logic: EVERY_SLOT_LOGIC } as unknown as SlotDef;
			slot = new Slot(this, def);
			this.#slots.set(index, slot);
		}
		return slot;
	}

	override get slots(): DeviceSlots {
		return this.#slotTable;
	}

	override get hasSlots(): boolean {
		return true;
	}
}

/**
 * Let a housing answer every logic type, as the device a chip is meant to sit in would (an air
 * conditioner, a suit): one it doesn't have reads what was last written to it, or 0. Its own logic
 * types keep their read and write rules.
 */
export function acceptEveryLogicType(housing: Housing): void {
	const props = housing.props!;
	const own = new Set((housing.rawData?.logics ?? []).map((logic) => Logics.getByKey(logic.name as never) as number));
	const extra = new Map<number, number>();
	const code = (prop: number | string) => (typeof prop === "number" ? prop : (Logics.getByKey(prop as never) as number | undefined));
	// Instructions reach the housing's own logic types the usual way, with the hooks set aside.
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
		canLoad: (prop) => (own.has(code(prop)!) ? direct(() => props.canLoad(prop)) : code(prop) !== undefined),
		canStore: (prop) => (own.has(code(prop)!) ? direct(() => props.canStore(prop)) : code(prop) !== undefined),
		read: (prop) => (own.has(code(prop)!) ? direct(() => props.read(prop)) : (extra.get(code(prop)!) ?? 0)),
		write: (prop, value) => {
			if (own.has(code(prop)!)) direct(() => props.write(prop, value));
			else extra.set(code(prop)!, value);
		},
	};
}

/** Put a stub on every one of the housing's pins, and one with each of `ids` on its network. */
export function connectStubs(housing: Housing, ids: Iterable<number>): void {
	const network = housing.network;
	const taken = (id: number) => network.deviceById(id) !== undefined;
	for (const id of ids) {
		if (!taken(id)) network.apply(new StubDevice(id));
	}
	let next = 0x7f000000;
	for (let pin = 0; pin < housing.pin_count; pin++) {
		while (taken(next)) next++;
		const stub: Device = new StubDevice(next);
		network.apply(stub);
		housing.connectDevices(pin, stub);
	}
}
