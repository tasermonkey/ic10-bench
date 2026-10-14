import { describe, expect, it } from "vitest";
import { CATALOG, findings, prefab } from "./helpers.ts";

const check = (source: string) => findings("hash-name", source, { catalog: CATALOG });

describe("hash-name", () => {
	it("is an error to HASH a number, which hashes its text", async () => {
		expect(await check('define ID HASH("123")\nmove r0 HASH("$1F")')).toEqual([
			[0, "error", 'HASH("123") hashes the text "123", not the number 123'],
			[1, "error", 'HASH("$1F") hashes the text "$1F", not the number $1F'],
		]);
	});

	it("warns about a prefab-shaped name the game doesn't have", async () => {
		expect(await check('define VENT HASH("StructureActivVent")')).toEqual([
			[0, "warning", 'HASH("StructureActivVent") looks like a prefab, but the game has no prefab StructureActivVent'],
		]);
	});

	it("knows every game prefab, items included, without a catalogue", async () => {
		expect(await findings("hash-name", 'define CROP HASH("ItemWheat")\ndefine PA HASH("StructurePipeAnalysizer")')).toEqual([]);
	});

	it("knows the catalogue's mods", async () => {
		const catalog = { prefabs: { StructureModWidget: prefab("StructureModWidget", {}) } };
		expect(await findings("hash-name", 'define W HASH("StructureModWidget")', { catalog })).toEqual([]);
		expect(await findings("hash-name", 'define W HASH("StructureModWidget")')).toHaveLength(1);
	});

	it("leaves device names, and a batch instruction's type (batch-ops' job, given a catalogue), alone", async () => {
		expect(
			await check(`define LIGHT HASH("StructureWallLight")
sbn LIGHT HASH("Green Dock") On 1
sbn HASH("StructureWallLite") HASH("EchoStar") On 1
lbn r0 LIGHT HASH("Structure Room") On Maximum`),
		).toEqual([]);
		expect(await findings("hash-name", 'sb HASH("StructureWallLite") On 1')).toHaveLength(1);
	});
});
