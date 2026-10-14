import type { DeviceHandle } from "./device.ts";

/** The devices on one data network. */
export class NetworkHandle {
	private readonly handles: DeviceHandle[];

	constructor(handles: DeviceHandle[]) {
		this.handles = handles;
	}

	devices(): DeviceHandle[] {
		return [...this.handles];
	}

	/** Devices with this in-game name. */
	byName(name: string): DeviceHandle[] {
		return this.handles.filter((d) => d.name === name);
	}

	/** Devices of this prefab. */
	byType(prefab: string): DeviceHandle[] {
		return this.handles.filter((d) => d.prefab === prefab);
	}
}
