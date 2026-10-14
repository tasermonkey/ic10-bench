import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProjectCatalog } from "../src/cli/catalog.ts";
import { importMods, NoExportError } from "../src/cli/import-mods.ts";

const BIN = join(import.meta.dirname, "..", "bin", "ic10-bench.ts");

/** A Stationpedia export with one game prefab and one mod's. */
function writeExport(dir: string) {
	mkdirSync(dir, { recursive: true });
	const page = (PrefabName: string, PrefabHash: number, LogicTypes: Record<string, string>) => ({
		PrefabName,
		PrefabHash,
		Title: PrefabName,
		LogicInfo: { LogicTypes, LogicSlotTypes: {} },
	});
	const pages = [
		page("StructureWallLight", -1860064656, { On: "ReadWrite", Power: "Read" }),
		page("ModFixtureWidget", 123456, { Setting: "ReadWrite", Ratio: "Read" }),
	];
	writeFileSync(join(dir, "Stationpedia.json"), JSON.stringify({ version: "0.2.9999.1", pages }));
}

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "ic10-bench-cli-"));
	vi.stubEnv("STATIONEERS_DIR", join(root, "no-game")); // no game: no descriptions, no workshop
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

describe("ic10-bench import-mods", () => {
	it("writes this machine's ic10-mods/ file with the prefabs the emulator doesn't have", async () => {
		writeExport(join(root, "export"));
		const lines = await importMods(join(root, "export"), root);

		const [file] = readdirSync(join(root, "ic10-mods"));
		const written = JSON.parse(readFileSync(join(root, "ic10-mods", file!), "utf8"));
		expect(written.gameVersion).toBe("0.2.9999.1");
		expect(written.prefabs.map((p: { prefab: string }) => p.prefab)).toEqual(["ModFixtureWidget"]);
		expect(written.prefabs[0].logic).toEqual({ Setting: "rw", Ratio: "r" });
		expect(lines).toContain("  added: ModFixtureWidget");
		expect(lines.join("\n")).toMatch(/1 mod prefabs, 0 workshop mods \(game 0\.2\.9999\.1\)/);

		// Run again: nothing new.
		expect(await importMods(join(root, "export"), root)).toContain("  added: none");
	});

	it("says how to make an export when there isn't one", async () => {
		await expect(importMods(join(root, "empty"), root)).rejects.toThrow(NoExportError);
	});
});

describe("ic10-bench catalog", () => {
	it("writes the project's catalogue and types, with its mods, and works without the game", async () => {
		writeExport(join(root, "export"));
		await importMods(join(root, "export"), root);
		const lines = await buildProjectCatalog(root);

		const catalog = JSON.parse(readFileSync(join(root, ".ic10-bench", "catalog.json"), "utf8"));
		expect(catalog.prefabs.ModFixtureWidget).toMatchObject({ source: "mod", logic: { Setting: "rw", Ratio: "r" } });
		expect(catalog.prefabs.StructureWallLight).toMatchObject({ source: "game" });
		expect(readFileSync(join(root, "ic10-bench-env.d.ts"), "utf8")).toContain("ModFixtureWidget");
		expect(lines.join("\n")).toMatch(/1 from mods/);
	});
});

describe("the ic10-bench command", () => {
	const run = (...args: string[]) => {
		try {
			return { status: 0, out: execFileSync(process.execPath, ["--conditions=source", BIN, "--project", root, ...args], { encoding: "utf8" }) };
		} catch (error) {
			const e = error as { status: number; stdout: string };
			return { status: e.status, out: e.stdout };
		}
	};

	it("prints the usage for --help, and fails on an unknown command", () => {
		expect(run("--help")).toMatchObject({ status: 0, out: expect.stringContaining("ic10-bench lint") });
		expect(run("frobnicate").status).toBe(1);
	});

	it("looks up a prefab", () => {
		const { status, out } = run("props", "StructureActiveVent");
		expect(status).toBe(0);
		expect(out).toMatch(/^StructureActiveVent +Active Vent/);
	});

	it("lints the project's scripts, with its catalogue", () => {
		mkdirSync(join(root, "ic10"));
		writeFileSync(join(root, "ic10", "ok.ic10"), "start:\nyield\nj start");
		expect(run("lint")).toMatchObject({ status: 0, out: expect.stringContaining("0 errors, 0 warnings in 1 scripts") });

		writeFileSync(join(root, "ic10", "bad.ic10"), 'sb HASH("StructureActiveVent") Charge 1');
		const bad = run("lint");
		expect(bad.status).toBe(1);
		expect(bad.out).toContain("ic10/bad.ic10:1:32 error batch-ops StructureActiveVent has no Charge");
		expect(existsSync(join(root, ".ic10-bench", "catalog.json"))).toBe(false); // the packaged catalogue was enough
	});
});
