import { describe, expect, it } from "vitest";
import { findings } from "./helpers.ts";

describe("relative-branch-to-label", () => {
	const check = (source: string) => findings("relative-branch-to-label", source);

	it("warns when a br* or jr is given a label", async () => {
		expect(await check("move r0 0\nloop:\nbrgtz r0 loop\njr loop")).toEqual([
			[2, "warning", "brgtz takes an offset, so it jumps by loop's line number (1), not to loop; use bgtz"],
			[3, "warning", "jr takes an offset, so it jumps by loop's line number (1), not to loop; use j"],
		]);
	});

	it("leaves offsets, and absolute branches to labels, alone", async () => {
		expect(await check("loop:\nbrgtz r0 2\nbrlt r0 r1 -1\nbgtz r0 loop\njr 3")).toEqual([]);
	});
});

describe("absolute-jump-number", () => {
	const check = (source: string) => findings("absolute-jump-number", source);

	it("warns about a jump or branch to a line number", async () => {
		expect(await check("move r0 1\nj 5\nbeqz r0 3\njal $4\nbdns d0 2")).toEqual([
			[1, "warning", "j to line 5 by number: it moves when lines are added above it; jump to a label instead"],
			[2, "warning", "beqz to line 3 by number: it moves when lines are added above it; jump to a label instead"],
			[3, "warning", "jal to line $4 by number: it moves when lines are added above it; jump to a label instead"],
			[4, "warning", "bdns to line 2 by number: it moves when lines are added above it; jump to a label instead"],
		]);
	});

	it("leaves labels, defines, registers, line 0 and relative branches alone", async () => {
		expect(await check("define TOP 0\nstart:\nj start\nj TOP\nj ra\nj 0\nbrgtz r0 3\nbeq r0 r1 r2")).toEqual([]);
	});

	it("leaves a jump past a per-chip block to per-chip-jump, but not one before it", async () => {
		expect(await check("move r0 1\npush 0 # link-per-chip {\npush 1\npoke 0 sp # link-per-chip }\nj 1\nj 4")).toEqual([
			[4, "warning", "j to line 1 by number: it moves when lines are added above it; jump to a label instead"],
		]);
	});
});

describe("per-chip-jump", () => {
	const check = (source: string) => findings("per-chip-jump", source);
	const BLOCK = "move r0 1\npush 0 # link-per-chip {\npush 1\npush 2\npoke 0 sp # link-per-chip }";
	const about = "the per-chip block starting on line 1 has as many lines as each chip gives it, so it lands on a different line on each; use a label";

	it("warns about a jump to a line number past a block's start", async () => {
		expect(await check(`${BLOCK}\nj 6\nbeqz r0 2\nj 1\nj 0`)).toEqual([
			[5, "warning", `j to line 6 by number: ${about}`],
			[6, "warning", `beqz to line 2 by number: ${about}`],
		]);
	});

	it("warns about a relative branch by a number across a block, either way, but not one beside it or within it", async () => {
		expect(await check(`brgtz r0 6\n${BLOCK.split("\n").slice(1).join("\n")}\nmove r0 2\njr -4\nbrltz r0 1\nmove r0 3`)).toEqual([
			[0, "warning", `brgtz by 6 lines, across a per-chip block: ${about}`],
			[6, "warning", `jr by -4 lines, across a per-chip block: ${about}`],
		]);
		expect(await check("move r0 1\npush 0 # link-per-chip {\nbrgtz r0 1\npush 1\npoke 0 sp # link-per-chip }")).toEqual([]);
	});

	it("says nothing in a script with no block, or about labels", async () => {
		expect(await check("move r0 1\nj 1\nbrgtz r0 2")).toEqual([]);
		expect(await check(`${BLOCK}\nstart:\nj start`)).toEqual([]);
	});

	it("takes a block from the per-script file", async () => {
		expect(await findings("per-chip-jump", "push 0\npush 1\npoke 0 sp\nj 3", { perChip: { blocks: [{ from: "push 0", to: "poke 0 sp" }] } })).toEqual([
			[3, "warning", "j to line 3 by number: the per-chip block starting on line 0 has as many lines as each chip gives it, so it lands on a different line on each; use a label"],
		]);
	});
});
