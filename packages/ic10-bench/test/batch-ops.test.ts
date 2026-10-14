import { describe, expect, it } from "vitest";
import { checkBatchOps, loadCatalog } from "../src/index.ts";

// The check itself is tested in @tasermonkey/ic10-lint; this is the re-export, with this package's catalogue.
describe("checkBatchOps", () => {
	it("checks against the project's catalogue", () => {
		const findings = checkBatchOps('sb HASH("StructureActiveVent") Charge 1\nsb HASH("StructureActiveVent") On 1', loadCatalog());
		expect(findings.map((f) => [f.line, f.problem, f.message])).toEqual([[0, "no-such-property", "StructureActiveVent has no Charge"]]);
	});
});
