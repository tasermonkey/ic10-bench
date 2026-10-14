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
});
