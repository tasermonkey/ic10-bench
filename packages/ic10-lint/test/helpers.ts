import { HashString } from "@tasermonkey/ic10";
import { type LintOptions, lint } from "../src/lint.ts";
import type { BatchOpCatalog, LintPrefab } from "../src/types.ts";

/** One rule's findings, as [line, severity, message]. */
export async function findings(rule: string, source: string, options: LintOptions = {}) {
	const all = await lint(source, options);
	return all.filter((f) => f.rule === rule).map((f) => [f.line, f.severity, f.message] as const);
}

/** `n` lines of `move r0 1`. */
export const code = (n: number, line = "move r0 1") => Array.from({ length: n }, () => line).join("\n");

export const prefab = (name: string, logic: LintPrefab["logic"], slots: LintPrefab["slots"] = []): LintPrefab => ({
	prefab: name,
	hash: new HashString(name).hash,
	logic,
	slots,
});

export const CATALOG: BatchOpCatalog = {
	prefabs: Object.fromEntries(
		[
			prefab("StructureActiveVent", { Mode: "rw", PressureOutput: "r", Lock: "w", On: "rw" }),
			prefab("StructureLogicDial", { Setting: "rw" }),
			prefab("StructureBattery", { Charge: "r" }, [{ index: 0, logic: ["Occupied", "Charge"] }]),
			prefab("StructureSorter", { On: "rw" }, [{ index: 0, logic: ["Occupied", "Quantity"] }]),
			prefab("StructureWallLight", { On: "rw" }),
			prefab("StructureGasSensor", { Temperature: "r" }),
			prefab("ItemIronOre", {}),
		].map((p) => [p.prefab, p]),
	),
};
