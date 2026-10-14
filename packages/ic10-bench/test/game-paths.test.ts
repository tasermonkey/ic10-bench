import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { englishXmlPath, gameDir, stationpediaDir, workshopDir } from "../src/catalog/game-paths.ts";

/** A Steam library with the game in it: <library>/steamapps/common/Stationeers, and its workshop folder. */
const library = mkdtempSync(join(tmpdir(), "ic10-bench-steam-"));
const game = join(library, "steamapps", "common", "Stationeers");
const english = join(game, "rocketstation_Data", "StreamingAssets", "Language", "english.xml");
mkdirSync(join(english, ".."), { recursive: true });
writeFileSync(english, "<Language />");
mkdirSync(join(game, "Stationpedia"));
mkdirSync(join(library, "steamapps", "workshop", "content", "544550"), { recursive: true });

afterEach(() => {
	vi.unstubAllEnvs();
});
afterAll(() => rmSync(library, { recursive: true, force: true }));

describe("finding the game", () => {
	it("uses STATIONEERS_DIR, and finds english.xml and the Stationpedia export in it", () => {
		vi.stubEnv("STATIONEERS_DIR", game);
		expect(gameDir()).toBe(game);
		expect(englishXmlPath()).toBe(english);
		expect(stationpediaDir()).toBe(join(game, "Stationpedia"));
	});

	it("finds nothing when STATIONEERS_DIR doesn't exist, rather than looking elsewhere", () => {
		vi.stubEnv("STATIONEERS_DIR", join(library, "nowhere"));
		expect(gameDir()).toBeUndefined();
		expect(englishXmlPath()).toBeUndefined();
		expect(stationpediaDir()).toBeUndefined();
	});

	it("finds no english.xml or export in a game folder without them", () => {
		const bare = mkdtempSync(join(tmpdir(), "ic10-bench-game-"));
		try {
			vi.stubEnv("STATIONEERS_DIR", bare);
			expect(englishXmlPath()).toBeUndefined();
			expect(stationpediaDir()).toBeUndefined();
		} finally {
			rmSync(bare, { recursive: true, force: true });
		}
	});

	it("finds the workshop folder of the library the game is in", () => {
		expect(workshopDir(game)).toBe(join(library, "steamapps", "workshop", "content", "544550"));
		expect(workshopDir(join(tmpdir(), "a", "b", "c"))).toBeUndefined();
	});
});
