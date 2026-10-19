import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CliIo, runCli } from "../../src/cli.ts";
import { type Folder, makeFolder, touch } from "../project.ts";

const folders: Folder[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) folder.remove();
});

function setup(chips: Record<string, string> = {}) {
	const chipdata = makeFolder({
		"Base/Lights [451].ic10": "yield",
		...Object.fromEntries(Object.entries(chips).map(([name, text]) => [`Base/${name}`, text])),
	});
	const project = makeFolder({ "ic10/lights.ic10": "yield", "stations/Base.json": { chips: { "451": "ic10/lights.ic10" } } });
	folders.push(chipdata, project);
	return { chipdata, project };
}

/**
 * `ic10-link repl --chipdata <chipdata>`, reading what `type` writes; `output()` is all it has
 * printed. `tty` makes the output look like a terminal, so the REPL hands `choose` the keys.
 */
function startRepl(project: Folder, chipdata: Folder, { tty = false, choose }: { tty?: boolean; choose?: CliIo["choose"] } = {}) {
	const input = new PassThrough();
	const output = Object.assign(new PassThrough(), tty ? { isTTY: true, columns: 200 } : {});
	let text = "";
	output.on("data", (chunk) => (text += chunk));
	const done = runCli(["repl", "--chipdata", chipdata.root], {
		cwd: project.root,
		out: (line) => (text += `${line}\n`),
		env: {},
		documents: () => undefined,
		findTests: async () => [],
		choose,
		terminal: { input, output },
	});
	const newline = tty ? "\r" : "\n";
	return {
		input,
		type: (...lines: string[]) => input.write(lines.map((line) => `${line}${newline}`).join("")),
		end: () => input.end(),
		output: () => text,
		done,
	};
}

describe("ic10-link repl", () => {
	it("runs commands one after another, with the station it was started with, until exit", async () => {
		const { chipdata, project } = setup();
		writeFileSync(join(project.root, "ic10", "Sync Demo.ic10"), "yield");
		const session = startRepl(project, chipdata);
		session.type("status", 'map 452 "ic10/Sync Demo.ic10"', 'per-chip "ic10/Sync Demo.ic10" ROOM', "exit");
		expect(await session.done).toBe(0);
		expect(session.output()).toContain("ic10/Sync Demo.ic10.json: ROOM now per-chip\n");
		expect(session.output()).toContain("watch runs in the background, and stop ends it.");
		expect(session.output()).toContain("ic10-link> Station: Base\n");
		expect(session.output()).toContain("Mapped [452] ? -> ic10/Sync Demo.ic10\n");
		expect(JSON.parse(readFileSync(join(project.root, "stations", "Base.json"), "utf8")).chips["452"]).toBe("ic10/Sync Demo.ic10");
	});

	it("says what's wrong with a line, and goes on", async () => {
		const { chipdata, project } = setup();
		const session = startRepl(project, chipdata);
		session.type('map 450 "ic10/a.ic10', "repl", "stop", "frobnicate", "status");
		session.end();
		expect(await session.done).toBe(0);
		expect(session.output()).toContain('no closing "\n');
		expect(session.output()).toContain("Already in the REPL.\n");
		expect(session.output()).toContain("Not watching.\n");
		expect(session.output()).toContain("error: unknown command 'frobnicate'");
		expect(session.output()).toContain("Station: Base\n");
	});

	it("runs watch in the background, beside other commands, until stop", async () => {
		const { chipdata, project } = setup();
		writeFileSync(join(project.root, "ic10", "lights.ic10"), "sleep 1");
		const session = startRepl(project, chipdata);
		session.type("watch");
		await vi.waitFor(() => expect(session.output()).toMatch(/\d\d:\d\d:\d\d ic10\/lights\.ic10 -> Base\/\[451\] Lights /), { timeout: 5000 });
		expect(session.output()).toMatch(/Watching .*\. stop stops\.\n/);
		expect(readFileSync(join(chipdata.root, "Base", "Lights [451].ic10"), "utf8")).toBe("sleep 1");

		session.type("status", "once", "watch", "stop", "exit");
		expect(await session.done).toBe(0);
		expect(session.output()).toContain("ic10-link (watching)> ");
		expect(session.output()).toContain("[451] Lights -> ic10/lights.ic10: same\n");
		expect(session.output()).toContain("watch is running, and already does what once does. stop it first.\n");
		expect(session.output()).toContain("Already watching. stop it first.\n");
		expect(session.output()).toContain("Stopped watching.\n");
	});

	it("stops watching when the input ends", async () => {
		const { chipdata, project } = setup();
		const session = startRepl(project, chipdata);
		session.type("watch");
		await vi.waitFor(() => expect(session.output()).toContain("Watching "), { timeout: 5000 });
		session.end();
		expect(await session.done).toBe(0);
		expect(session.output()).toContain("Stopped watching.\n");
	});

	it("in a terminal, hands the keys to the pick list for a command's question, and takes them back", async () => {
		const { chipdata, project } = setup({ "Room Lights [451].ic10": "yield\nyield" });
		touch(join(chipdata.root, "Base", "Lights [451].ic10"), 3600);
		let readers: number | undefined;
		const asked: string[][] = [];
		const choose = async (_question: string, choices: string[]) => {
			readers = session.input.listenerCount("keypress");
			asked.push(choices);
			return 1;
		};
		const session = startRepl(project, chipdata, { tty: true, choose });
		session.type("status", "exit");
		expect(await session.done).toBe(0);
		expect(readers).toBe(0);
		expect(asked).toEqual([[expect.stringMatching(/^Lights \[451\]\.ic10 /), expect.stringMatching(/^Room Lights \[451\]\.ic10 /), "Skip: keep them all"]]);
		expect(session.output()).toContain("  deleted Lights [451].ic10\n");
		expect(session.output()).not.toContain("1) Lights");
		expect(existsSync(join(chipdata.root, "Base", "Lights [451].ic10"))).toBe(false);
	});

	it("holds a background watch's lines while the pick list is open, and prints them after", async () => {
		const { chipdata, project } = setup({ "Room Lights [451].ic10": "yield", "Air [452].ic10": "yield" });
		writeFileSync(join(project.root, "ic10", "air.ic10"), "yield");
		writeFileSync(join(project.root, "stations", "Base.json"), JSON.stringify({ chips: { "451": "ic10/lights.ic10", "452": "ic10/air.ic10" } }));
		const sent = /ic10\/air\.ic10 -> Base\/\[452\] Air /;
		let duringQuestion = "";
		const choose = async (_question: string, choices: string[]) => {
			writeFileSync(join(project.root, "ic10", "air.ic10"), "sleep 1");
			await vi.waitFor(() => expect(readFileSync(join(chipdata.root, "Base", "Air [452].ic10"), "utf8")).toBe("sleep 1"), { timeout: 5000 });
			await new Promise((resolve) => setTimeout(resolve, 50));
			duringQuestion = session.output();
			return choices.length - 1;
		};
		const session = startRepl(project, chipdata, { tty: true, choose });
		session.type("watch");
		await vi.waitFor(() => expect(session.output()).toContain("Watching "), { timeout: 5000 });
		session.type("status");
		await vi.waitFor(() => expect(session.output()).toMatch(sent), { timeout: 10000 });
		expect(duringQuestion).not.toMatch(sent);
		session.type("stop", "exit");
		expect(await session.done).toBe(0);
	});

	it("asks a command's question at the prompt, by number, without a terminal", async () => {
		const { chipdata, project } = setup({ "Room Lights [451].ic10": "yield\nyield" });
		touch(join(chipdata.root, "Base", "Lights [451].ic10"), 3600);
		const session = startRepl(project, chipdata);
		session.type("status", "5", "2", "exit");
		expect(await session.done).toBe(0);
		expect(session.output()).toContain("Which one is current? The others are deleted.\n  1) Lights [451].ic10 ");
		expect(session.output()).toContain("  3) Skip: keep them all\n");
		expect(session.output()).toContain("  deleted Lights [451].ic10\n");
		expect(existsSync(join(chipdata.root, "Base", "Lights [451].ic10"))).toBe(false);
	});

	it("needs somewhere to read from", async () => {
		let output = "";
		const code = await runCli(["repl"], { cwd: ".", out: (line) => (output += `${line}\n`), env: {}, documents: () => undefined });
		expect(code).toBe(2);
		expect(output).toBe("repl needs a terminal to read from.\n");
	});
});
