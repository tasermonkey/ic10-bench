import { describe, expect, it } from "vitest";
import { splitWords } from "../../src/repl/words.ts";

describe("splitWords", () => {
	it("splits on spaces, and keeps a quoted word's spaces", () => {
		expect(splitWords('  map 450 "ic10/Tests/Sync Demo.ic10"  ')).toEqual(["map", "450", "ic10/Tests/Sync Demo.ic10"]);
		expect(splitWords("status --station 'Real Creative'")).toEqual(["status", "--station", "Real Creative"]);
		expect(splitWords('a"b c"d')).toEqual(["ab cd"]);
	});

	it("keeps backslashes, for Windows' paths, and an empty quoted word", () => {
		expect(splitWords('status --chipdata "D:\\My Games\\chipdata" ""')).toEqual(["status", "--chipdata", "D:\\My Games\\chipdata", ""]);
	});

	it("finds no words in a blank line, and throws for a quote left open", () => {
		expect(splitWords("   ")).toEqual([]);
		expect(() => splitWords('map 450 "ic10/a.ic10')).toThrow('no closing "');
	});
});
