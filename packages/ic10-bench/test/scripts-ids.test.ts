import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findScripts, formatId, parseId, readScript } from "../src/index.ts";

describe("readScript / findScripts", () => {
	const dir = mkdtempSync(join(tmpdir(), "ic10-bench-scripts-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));
	for (const [path, text] of [
		["b.ic10", "move r0 1\r\nyield\r\n"],
		["a/z.ic10", "yield"],
		["a/notes.txt", "not a script"],
		["c/d/e.ic10", ""],
	]) {
		mkdirSync(join(dir, path, ".."), { recursive: true });
		writeFileSync(join(dir, path), text);
	}

	it("reads a script with CRLF turned into LF", () => {
		expect(readScript(join(dir, "b.ic10"))).toBe("move r0 1\nyield\n");
	});

	it("finds every .ic10 file below a folder, sorted, as absolute paths", () => {
		expect(findScripts(dir)).toEqual([join(dir, "a", "z.ic10"), join(dir, "b.ic10"), join(dir, "c", "d", "e.ic10")]);
	});
});

describe("parseId / formatId", () => {
	it("reads a reference ID as a number, a decimal string or the game's $hex form", () => {
		expect(parseId(5256)).toBe(5256);
		expect(parseId("5256")).toBe(5256);
		expect(parseId("$1488")).toBe(0x1488);
		expect(parseId(" $ae16a ")).toBe(0xae16a);
	});

	it("rejects anything else", () => {
		for (const id of [-1, 1.5, "", "$", "$ZZ", "12abc", "-3", "1e3", "%101"]) {
			expect(() => parseId(id), String(id)).toThrow(/invalid reference ID/);
		}
	});

	it("formats an ID the way the game shows it", () => {
		expect(formatId(0x1488)).toBe("$1488");
		expect(formatId(0xae16a)).toBe("$AE16A");
		expect(parseId(formatId(802081))).toBe(802081);
	});
});
