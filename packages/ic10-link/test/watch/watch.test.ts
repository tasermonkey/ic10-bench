import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findStation } from "../../src/game/chipdata.ts";
import { watch } from "../../src/watch/watch.ts";
import { type Folder, makeFolder } from "../project.ts";

const folders: Folder[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) folder.remove();
});

describe("watch", () => {
	it("sends the script at the start, and again when it changes, until stopped", async () => {
		const chipdata = makeFolder({ "Base/Air [1].ic10": "" });
		const project = makeFolder({ "ic10/air.ic10": "yield", "stations/Base.json": { chips: { "1": "ic10/air.ic10" } } });
		folders.push(chipdata, project);
		const chip = join(chipdata.root, "Base", "Air [1].ic10");
		const log: string[] = [];
		const stop = new AbortController();
		const watching = watch({
			root: project.root,
			station: findStation(chipdata.root),
			log: (line) => log.push(line),
			findTests: async () => [],
			signal: stop.signal,
		});

		await vi.waitFor(() => expect(readFileSync(chip, "utf8")).toBe("yield"), { timeout: 5000 });
		writeFileSync(join(project.root, "ic10", "air.ic10"), "sleep 1");
		await vi.waitFor(() => expect(readFileSync(chip, "utf8")).toBe("sleep 1"), { timeout: 5000 });

		stop.abort();
		await watching;
		expect(log[0]).toMatch(/^Watching /);
		expect(log.filter((line) => line.startsWith("ic10/air.ic10 -> Base/[1] Air "))).toHaveLength(2);
	});
});
