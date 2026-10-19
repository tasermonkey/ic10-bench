import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findStation } from "../../src/game/chipdata.ts";
import type { TestRun } from "../../src/sync/gate.ts";
import { loadState } from "../../src/sync/state.ts";
import { newSession, type SyncOptions, syncOnce } from "../../src/sync/sync.ts";
import { type Folder, makeFolder } from "../project.ts";

const folders: Folder[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) folder.remove();
});

const LOOP = "start:\nyield\nj start";
/** Over the game's 128 lines: a lint error. */
const TOO_LONG = Array.from({ length: 130 }, () => "yield").join("\n");

/** A station "Base" with chips, and a project with scripts mapping chip id → script. */
function setup(chips: Record<string, string>, scripts: Record<string, string | object>, map: Record<string, string>) {
	const chipdata = makeFolder(Object.fromEntries(Object.entries(chips).map(([name, text]) => [`Base/${name}`, text])));
	const project = makeFolder({ ...scripts, "stations/Base.json": { chips: map } });
	folders.push(chipdata, project);
	const station = findStation(chipdata.root);
	const log: string[] = [];
	const runs: string[][] = [];
	let testsPass = true;
	const options: SyncOptions = {
		root: project.root,
		station,
		log: (line) => log.push(line),
		session: newSession(),
		findTests: async (_root, script) => (script.includes("tested") ? [join(project.root, "tests", "tested.test.ts")] : []),
		runTests: async (_root, files): Promise<TestRun> => {
			runs.push(files);
			return { ok: testsPass, output: testsPass ? "1 passed" : "FAIL tests/tested.test.ts\nexpected 1 to be 0" };
		},
	};
	return {
		options,
		log,
		runs,
		failTests: () => (testsPass = false),
		chip: (name: string) => readFileSync(join(station.dir, name), "utf8"),
		setChip: (name: string, text: string) => writeFileSync(join(station.dir, name), text),
		script: (path: string) => readFileSync(join(project.root, path), "utf8"),
		setScript: (path: string, text: string) => writeFileSync(join(project.root, path), text),
		project,
	};
}

describe("syncOnce", () => {
	it("sends a newly mapped script to its chip, keeping the chip's code before in preserved/<station>/backups/", async () => {
		const s = setup({ "Air [1].ic10": "yield" }, { "ic10/air.ic10": `${LOOP}\r\n` }, { "1": "ic10/air.ic10" });
		expect(await syncOnce(s.options)).toEqual([{ id: "1", script: "ic10/air.ic10", kind: "deployed" }]);
		expect(s.chip("Air [1].ic10")).toBe(LOOP);
		expect(readFileSync(join(s.project.root, ".ic10-link", "preserved", "Base", "backups", "Air [1].ic10"), "utf8")).toBe("yield");
		expect(s.log).toEqual([
			"[1] Air: its code before is kept in .ic10-link/preserved/Base/backups/Air [1].ic10",
			"ic10/air.ic10 -> Base/[1] Air (lint ok; no tests name this script)",
		]);
		expect(Object.keys(loadState(s.project.root).Base!)).toEqual(["1"]);
	});

	it("colours the station's name with color: true", async () => {
		const s = setup({ "Air [1].ic10": "" }, { "ic10/air.ic10": LOOP }, { "1": "ic10/air.ic10" });
		await syncOnce({ ...s.options, color: true });
		expect(s.log.at(-1)).toBe("ic10/air.ic10 -> \u001b[35mBase\u001b[39m/[1] Air (lint ok; no tests name this script)");
	});

	it("does nothing when chip and script are the same, as the game reads them", async () => {
		const s = setup({ "Air [1].ic10": `${LOOP}\n` }, { "ic10/air.ic10": "start:  \r\nyield\r\nj start" }, { "1": "ic10/air.ic10" });
		expect((await syncOnce(s.options))[0]!.kind).toBe("in sync");
		expect(s.chip("Air [1].ic10")).toBe(`${LOOP}\n`);
		expect(s.log).toEqual([]);
		expect(existsSync(join(s.project.root, ".ic10-link", "preserved"))).toBe(false);
	});

	it("sends the script again each time it changes", async () => {
		const s = setup({ "Air [1].ic10": LOOP }, { "ic10/air.ic10": LOOP }, { "1": "ic10/air.ic10" });
		await syncOnce(s.options);
		s.setScript("ic10/air.ic10", `${LOOP}\nsleep 1`);
		expect((await syncOnce(s.options))[0]!.kind).toBe("deployed");
		expect(s.chip("Air [1].ic10")).toBe(`${LOOP}\nsleep 1`);
	});

	it("copies a chip edited in game to its script, with LF line endings, and checks it", async () => {
		const s = setup({ "Air [1].ic10": LOOP }, { "ic10/tested.ic10": LOOP }, { "1": "ic10/tested.ic10" });
		await syncOnce(s.options);
		s.setChip("Air [1].ic10", "start:\r\nsleep 1\r\nj start\r\n");
		expect(await syncOnce(s.options)).toEqual([{ id: "1", script: "ic10/tested.ic10", kind: "pulled" }]);
		expect(s.script("ic10/tested.ic10")).toBe("start:\nsleep 1\nj start\n");
		expect(s.log).toEqual(["Base/[1] Air -> ic10/tested.ic10 (edited in game; lint ok; tests pass: tests/tested.test.ts)"]);
		expect(s.runs).toHaveLength(1);

		// The chip and the script are the same now: nothing more to do, or say.
		expect((await syncOnce(s.options))[0]!.kind).toBe("in sync");
		expect(s.log).toHaveLength(1);
	});

	it("copies a chip edited in game even when it fails its checks, and says so", async () => {
		const s = setup({ "Air [1].ic10": LOOP }, { "ic10/tested.ic10": LOOP }, { "1": "ic10/tested.ic10" });
		await syncOnce(s.options);
		s.failTests();
		s.setChip("Air [1].ic10", "sleep 1");
		expect(await syncOnce(s.options)).toEqual([{ id: "1", script: "ic10/tested.ic10", kind: "pulled", failed: true }]);
		expect(s.script("ic10/tested.ic10")).toBe("sleep 1\n");
		expect(s.log).toEqual([
			"Base/[1] Air -> ic10/tested.ic10 (edited in game), and it fails its checks:",
			"  tests fail: tests/tested.test.ts",
			"    FAIL tests/tested.test.ts",
			"    expected 1 to be 0",
		]);
	});

	it("doesn't copy a chip emptied in game over its script", async () => {
		const s = setup({ "Air [1].ic10": LOOP }, { "ic10/air.ic10": LOOP }, { "1": "ic10/air.ic10" });
		await syncOnce(s.options);
		s.setChip("Air [1].ic10", "");
		expect((await syncOnce(s.options))[0]!.kind).toBe("emptied");
		expect(s.script("ic10/air.ic10")).toBe(LOOP);
		expect(s.log).toEqual(["Base/[1] Air: emptied in game; ic10/air.ic10 left as it is"]);
	});

	it("sends the script when both were changed, keeping the game's code in preserved/<station>/conflicts/", async () => {
		const s = setup({ "Air [1].ic10": LOOP }, { "ic10/air.ic10": LOOP }, { "1": "ic10/air.ic10" });
		await syncOnce(s.options);
		s.setChip("Air [1].ic10", "yield");
		s.setScript("ic10/air.ic10", "sleep 1");
		expect(await syncOnce(s.options)).toEqual([
			{ id: "1", script: "ic10/air.ic10", kind: "deployed", conflict: ".ic10-link/preserved/Base/conflicts/Air [1].ic10" },
		]);
		expect(s.chip("Air [1].ic10")).toBe("sleep 1");
		expect(s.script("ic10/air.ic10")).toBe("sleep 1");
		expect(readFileSync(join(s.project.root, ".ic10-link", "preserved", "Base", "conflicts", "Air [1].ic10"), "utf8")).toBe("yield");
		expect(s.log).toEqual([
			"Base/[1] Air: changed both in game and in ic10/air.ic10; the game's code is kept in .ic10-link/preserved/Base/conflicts/Air [1].ic10",
			"ic10/air.ic10 -> Base/[1] Air (lint ok; no tests name this script)",
		]);
	});

	it("keeps the game's code when both were changed and the script fails its checks, saying so once", async () => {
		const s = setup({ "Air [1].ic10": LOOP }, { "ic10/air.ic10": LOOP }, { "1": "ic10/air.ic10" });
		await syncOnce(s.options);
		s.setChip("Air [1].ic10", "yield");
		s.setScript("ic10/air.ic10", TOO_LONG);
		expect((await syncOnce(s.options))[0]).toMatchObject({ kind: "blocked", conflict: ".ic10-link/preserved/Base/conflicts/Air [1].ic10" });
		expect(s.chip("Air [1].ic10")).toBe("yield");
		const said = s.log.length;
		await syncOnce(s.options);
		expect(s.log).toHaveLength(said);
	});

	it("doesn't send a script with lint errors, and says so once", async () => {
		const s = setup({ "Air [1].ic10": LOOP }, { "ic10/air.ic10": TOO_LONG }, { "1": "ic10/air.ic10" });
		expect((await syncOnce(s.options))[0]!.kind).toBe("blocked");
		expect(s.chip("Air [1].ic10")).toBe(LOOP);
		expect(s.log[0]).toBe("[1] Air: not sent, ic10/air.ic10 failed its checks:");
		expect(s.log[1]).toMatch(/^ {2}ic10\/air\.ic10:129:1 error max-lines /);
		const said = s.log.length;
		expect((await syncOnce(s.options))[0]!.kind).toBe("blocked");
		expect(s.log).toHaveLength(said);
	});

	it("runs the script's tests, and doesn't send it when they fail", async () => {
		const s = setup({ "Air [1].ic10": "yield" }, { "ic10/tested.ic10": LOOP }, { "1": "ic10/tested.ic10" });
		s.failTests();
		expect((await syncOnce(s.options))[0]!.kind).toBe("blocked");
		expect(s.runs).toEqual([[join(s.project.root, "tests", "tested.test.ts")]]);
		expect(s.log).toEqual([
			"[1] Air: not sent, ic10/tested.ic10 failed its checks:",
			"  tests fail: tests/tested.test.ts",
			"    FAIL tests/tested.test.ts",
			"    expected 1 to be 0",
		]);
		expect(s.chip("Air [1].ic10")).toBe("yield");
	});

	it("sends the script when its tests pass, and says which ran", async () => {
		const s = setup({ "Air [1].ic10": "yield" }, { "ic10/tested.ic10": LOOP }, { "1": "ic10/tested.ic10" });
		await syncOnce(s.options);
		expect(s.log.at(-1)).toBe("ic10/tested.ic10 -> Base/[1] Air (lint ok; tests pass: tests/tested.test.ts)");
		expect(s.chip("Air [1].ic10")).toBe(LOOP);
	});

	it("checks a script once for all the chips that run it", async () => {
		const s = setup({ "A [1].ic10": "", "B [2].ic10": "" }, { "ic10/tested.ic10": LOOP }, { "1": "ic10/tested.ic10", "2": "ic10/tested.ic10" });
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["deployed", "deployed"]);
		expect(s.runs).toHaveLength(1);
	});

	it("checks lint only with tests: false", async () => {
		const s = setup({ "Air [1].ic10": "" }, { "ic10/tested.ic10": LOOP }, { "1": "ic10/tested.ic10" });
		await syncOnce({ ...s.options, tests: false });
		expect(s.runs).toEqual([]);
		expect(s.log.at(-1)).toBe("ic10/tested.ic10 -> Base/[1] Air (lint ok; tests not run (--no-tests))");
	});

	it("skips a chip with no file, several files, or no script, saying why once", async () => {
		const s = setup(
			{ "Old [2].ic10": "", "New [2].ic10": "" },
			{ "ic10/air.ic10": LOOP },
			{ "1": "ic10/air.ic10", "2": "ic10/air.ic10", "3": "ic10/gone.ic10" },
		);
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["not in game", "several files", "no script"]);
		expect(s.log).toEqual([
			"[1] not in game yet: the game writes its file once the station is loaded with the chip in it",
			"[2] has 2 files; skipped until ic10-link status picks the current one",
			"[3] ic10/gone.ic10: no such script",
		]);
		await syncOnce(s.options);
		expect(s.log).toHaveLength(3);
		expect(s.chip("Old [2].ic10")).toBe("");
	});
});

describe("syncOnce, with per-chip defines", () => {
	/** Room Lights, cut down: ROOM is per-chip (marked, or with marker "" for none), and `body` follows. */
	const room = (value: string, body = "yield", marker = " # link-per-chip") => `define ROOM ${value}${marker}\nstart:\n${body}\nj start`;

	it("counts a chip that differs only in a per-chip value as in sync, and writes nothing", async () => {
		const s = setup({ "Lights [1].ic10": room('HASH("Hall Light")') }, { "ic10/room.ic10": room('HASH("Room Light")') }, { "1": "ic10/room.ic10" });
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["in sync"]);
		expect(s.chip("Lights [1].ic10")).toBe(room('HASH("Hall Light")'));
		expect(s.script("ic10/room.ic10")).toBe(room('HASH("Room Light")'));
	});

	it("sends a changed script with the chip's own value", async () => {
		const s = setup({ "Lights [1].ic10": room('HASH("Hall Light")') }, { "ic10/room.ic10": room('HASH("Room Light")') }, { "1": "ic10/room.ic10" });
		await syncOnce(s.options);
		s.setScript("ic10/room.ic10", room('HASH("Room Light")', "sleep 1"));
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["deployed"]);
		expect(s.chip("Lights [1].ic10")).toBe(room('HASH("Hall Light")', "sleep 1"));
	});

	it("sends the script's value to a chip that doesn't have the define yet", async () => {
		const s = setup({ "Lights [1].ic10": "" }, { "ic10/room.ic10": room("1") }, { "1": "ic10/room.ic10" });
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["deployed"]);
		expect(s.chip("Lights [1].ic10")).toBe(room("1"));
	});

	it("copies a chip edited in game to its script with the script's own value", async () => {
		const s = setup({ "Lights [1].ic10": room("2") }, { "ic10/room.ic10": room("1") }, { "1": "ic10/room.ic10" });
		await syncOnce(s.options);
		s.setChip("Lights [1].ic10", room("2", "sleep 1"));
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["pulled"]);
		expect(s.script("ic10/room.ic10")).toBe(`${room("1", "sleep 1")}\n`);
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["in sync"]);
	});

	it("doesn't copy a change to only a per-chip value in game", async () => {
		const s = setup({ "Lights [1].ic10": room("1") }, { "ic10/room.ic10": room("1") }, { "1": "ic10/room.ic10" });
		await syncOnce(s.options);
		s.setChip("Lights [1].ic10", room("3"));
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["in sync"]);
		expect(s.script("ic10/room.ic10")).toBe(room("1"));
	});

	it("takes per-chip names from the script's .json the same way", async () => {
		const s = setup(
			{ "Lights [1].ic10": room("2", "yield", "") },
			{ "ic10/room.ic10": room("1", "yield", ""), "ic10/room.ic10.json": { perChip: { byDefineName: ["ROOM"] } } },
			{ "1": "ic10/room.ic10" },
		);
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["in sync"]);
		s.setScript("ic10/room.ic10", room("1", "sleep 1", ""));
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["deployed"]);
		expect(s.chip("Lights [1].ic10")).toBe(room("2", "sleep 1", ""));
	});

	it("skips the chip, naming the file, for a bad .json", async () => {
		const s = setup({ "Lights [1].ic10": "yield" }, { "ic10/room.ic10": "yield", "ic10/room.ic10.json": { perChip: [] } }, { "1": "ic10/room.ic10" });
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["blocked"]);
		expect(s.log).toEqual([expect.stringMatching(/^\[1\] Lights: skipped: .*room\.ic10\.json: "perChip" must be an object$/)]);
		expect(s.chip("Lights [1].ic10")).toBe("yield");
	});
});

describe("syncOnce, with per-chip blocks", () => {
	/** A script with a list pushed to the stack, each chip's own (marked, unless `marked` is false), and `body` after it. */
	const list = (items: string[], body = "yield", marked = true) =>
		[`push 0${marked ? " # link-per-chip {" : ""}`, ...items, `poke 0 sp${marked ? " # link-per-chip }" : ""}`, "start:", body, "j start"].join("\n");

	it("counts a chip whose list differs, in length too, as in sync, and writes nothing", async () => {
		const s = setup({ "Lights [1].ic10": list(["push 1", "push 2", "push 3"]) }, { "ic10/room.ic10": list(["push 9"]) }, { "1": "ic10/room.ic10" });
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["in sync"]);
		expect(s.chip("Lights [1].ic10")).toBe(list(["push 1", "push 2", "push 3"]));
	});

	it("counts a chip that has the list but not the markers as in sync, so marking a script sends nothing", async () => {
		const s = setup({ "Lights [1].ic10": list(["push 1", "push 2"], "yield", false) }, { "ic10/room.ic10": list(["push 9"]) }, { "1": "ic10/room.ic10" });
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["in sync"]);
	});

	it("sends a changed script with the chip's own list, and the script's markers", async () => {
		const s = setup({ "Lights [1].ic10": list(["push 1", "push 2"], "yield", false) }, { "ic10/room.ic10": list(["push 9"]) }, { "1": "ic10/room.ic10" });
		await syncOnce(s.options);
		s.setScript("ic10/room.ic10", list(["push 9"], "sleep 1"));
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["deployed"]);
		expect(s.chip("Lights [1].ic10")).toBe(list(["push 1", "push 2"], "sleep 1"));
	});

	it("copies a chip edited in game to its script with the script's own list", async () => {
		const s = setup({ "Lights [1].ic10": list(["push 1", "push 2"]) }, { "ic10/room.ic10": list(["push 9"]) }, { "1": "ic10/room.ic10" });
		await syncOnce(s.options);
		s.setChip("Lights [1].ic10", list(["push 1", "push 2"], "sleep 1"));
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["pulled"]);
		expect(s.script("ic10/room.ic10")).toBe(`${list(["push 9"], "sleep 1")}\n`);
	});

	it("sends the script's list to an empty chip, and to one without the list, keeping its code first", async () => {
		const s = setup(
			{ "Lights [1].ic10": "", "Other [2].ic10": "yield" },
			{ "ic10/room.ic10": list(["push 9"]) },
			{ "1": "ic10/room.ic10", "2": "ic10/room.ic10" },
		);
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["deployed", "deployed"]);
		expect(s.chip("Lights [1].ic10")).toBe(list(["push 9"]));
		expect(s.chip("Other [2].ic10")).toBe(list(["push 9"]));
		expect(s.log).toContain(
			'[2] Other: its per-chip block from "push 0" to "poke 0 sp" isn\'t in it, so it gets the script\'s; its code before is kept in .ic10-link/preserved/Base/backups/Other [2].ic10',
		);
	});

	it("doesn't send a chip whose own list takes it over the game's line limit", async () => {
		const long = Array.from({ length: 130 }, (_, i) => `push ${i}`);
		const s = setup({ "Lights [1].ic10": list(long) }, { "ic10/room.ic10": list(["push 9"]) }, { "1": "ic10/room.ic10" });
		await syncOnce(s.options);
		s.setScript("ic10/room.ic10", list(["push 9"], "sleep 1"));
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["blocked"]);
		expect(s.log.slice(0, 2)).toEqual(["[1] Lights: not sent, with its own per-chip lines it's over the game's limits:", expect.stringMatching(/^ {2}line 129: max-lines /)]);
		expect(s.chip("Lights [1].ic10")).toBe(list(long));
	});

	it("doesn't copy a chip whose list's anchor was edited away in game, keeping its code in conflicts/", async () => {
		const s = setup({ "Lights [1].ic10": list(["push 1"]) }, { "ic10/room.ic10": list(["push 9"]) }, { "1": "ic10/room.ic10" });
		await syncOnce(s.options);
		s.setChip("Lights [1].ic10", list(["push 1"]).replace("push 0", "push 5"));
		expect((await syncOnce(s.options)).map((o) => o.kind)).toEqual(["not pulled"]);
		expect(s.script("ic10/room.ic10")).toBe(list(["push 9"]));
		expect(s.log).toEqual([
			'Base/[1] Lights: edited in game, but its per-chip block from "push 0" to "poke 0 sp" isn\'t in it any more; not copied to ic10/room.ic10, its code is kept in .ic10-link/preserved/Base/conflicts/Lights [1].ic10',
		]);
	});
});
