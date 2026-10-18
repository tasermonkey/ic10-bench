import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { documentsFolder, expandWindowsVariables } from "../../src/game/os.ts";

describe("documentsFolder", () => {
	it("is Windows' Documents folder when there is one, else the one in the home folder", () => {
		expect(documentsFolder({}, () => "D:\\OneDrive\\Documents")).toBe("D:\\OneDrive\\Documents");
		expect(documentsFolder({}, () => undefined)).toBe(join(homedir(), "Documents"));
	});
});

describe("expandWindowsVariables", () => {
	it("expands %NAME%, whatever its case, and leaves unknown ones", () => {
		const env = { USERPROFILE: "C:\\Users\\me" };
		expect(expandWindowsVariables("%UserProfile%\\Documents", env)).toBe("C:\\Users\\me\\Documents");
		expect(expandWindowsVariables("%NOPE%\\Documents", env)).toBe("%NOPE%\\Documents");
	});
});
