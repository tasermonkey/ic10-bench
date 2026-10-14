import { describe, expect, it } from "vitest";
import { emulatorDevices, hasDeviceData } from "../src/engine/device.ts";
import { sim } from "../src/index.ts";

/**
 * Mods' devices and the Logic Mirror are added to the emulator's global device table when a world
 * uses them. That mustn't change what counts as the game's own data for the next world, or for
 * the catalogue and import-mods.
 */
describe("the emulator's device table", () => {
	it("doesn't count devices added for one world as the game's own data", async () => {
		const before = emulatorDevices().length;
		const world = await sim({ debug: false })
			.device("sensor", "StructureGasSensor")
			.mirror("mirror", { target: "sensor" })
			.device("dial", "ModularDeviceDial") // a mod's device, from the fixture project's ic10-mods/
			.build();
		expect(world.device("dial")).toHaveProps({ Setting: 0 });

		expect(hasDeviceData("StructureLogicMirror")).toBe(false);
		expect(hasDeviceData("ModularDeviceDial")).toBe(false);
		expect(emulatorDevices().map((d) => d.PrefabName)).not.toContain("StructureLogicMirror");
		expect(emulatorDevices().map((d) => d.PrefabName)).not.toContain("ModularDeviceDial");
		expect(emulatorDevices()).toHaveLength(before);
	});

	it("still won't build a Logic Mirror as a plain device in a later world", async () => {
		await sim({ debug: false }).device("sensor", "StructureGasSensor").mirror("mirror", { target: "sensor" }).build();
		await expect(sim({ debug: false }).device("m", "StructureLogicMirror" as "StructureGasSensor").build()).rejects.toThrow(
			/no device StructureLogicMirror in the emulator/,
		);
	});
});
