/**
 * A processor socket in the rack. The emulator runs a chip in a housing, so each socket is one: on
 * no network of its own, it answers with the rack's. `db` is the rack, d0-d5 go through the rack's
 * patch field, and `ld`/`sd` by ID and batch instructions see the rack's data network (nothing with
 * the I/O switch off). The chip's own stack (`push`, `pop`, `peek`, `poke`) stays the chip's.
 */
import { type Device, type Network, StructureCircuitHousing } from "@tasermonkey/ic10";
import type { RackDevice } from "./rack.ts";

export class SocketHousing extends StructureCircuitHousing {
	/** Set right after it's made: the housing's constructor runs before it can be. */
	rack?: RackDevice;

	override get network(): Network {
		return this.rack ? this.rack.chipNetwork : super.network;
	}

	override getConnectedDevices(pin: number): Device | undefined {
		const rack = this.rack;
		if (!rack) return super.getConnectedDevices(pin);
		return pin < 0 ? rack : rack.pinDevice(pin);
	}
}
