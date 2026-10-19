/** The catalogue's shape (see catalog.ts); plain types, so mods.ts and types.ts need not import the code. */

export type Access = "r" | "w" | "rw";

export interface CatalogSlot {
	index: number;
	name: string;
	type: string;
	logic: string[];
}

export interface CatalogPrefab {
	prefab: string;
	hash: number;
	title: string;
	/** Logic type → Read/Write. */
	logic: Record<string, Access>;
	slots: CatalogSlot[];
	/** Mode names; the index is the value. */
	modes: string[];
	/** "game": the emulator's game data. "mod": a device it doesn't have, from the project's ic10-mods/ (the export). */
	source: "game" | "mod";
}

export interface CatalogDescription {
	text: string;
	/** "stationpedia": the Stationpedia export's Enums.json. "game": the game's english.xml. */
	source: "stationpedia" | "game";
}

export interface Catalog {
	version: 1;
	builtAt: string;
	sources: { descriptions: string };
	logicTypes: Record<string, CatalogDescription>;
	slotLogicTypes: Record<string, CatalogDescription>;
	prefabs: Record<string, CatalogPrefab>;
}
