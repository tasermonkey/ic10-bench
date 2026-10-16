/**
 * The skeleton tests `ic10-bench init` writes: one per script, the same for every script but its
 * name and path. It doesn't read the script; wiring its devices and checking what it does is left
 * to whoever fills it in. The test is skipped, since a chip with nothing on a pin it uses halts.
 */
import { basename, dirname, isAbsolute, relative } from "node:path";

/** The script's file name, without `.ic10`. */
const scriptName = (script: string) => basename(script).replace(/\.ic10$/i, "");

/** `Integrated Circuit (IC10) [448].ic10` → `integrated-circuit-ic10-448.test.ts`. */
export function testFileName(script: string): string {
	const slug = scriptName(script).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	return `${slug || "script"}.test.ts`;
}

/**
 * Test files for `scripts`, in order, relative to the tests folder: the scripts folder's subfolders
 * mirrored (`rooms/lights.ic10` → `rooms/lights.test.ts`), and a script outside it at the top. A
 * name that's already taken in its folder gets `-2`, `-3`, …
 */
export function testFileNames(scripts: string[], scriptsDir: string): string[] {
	const taken = new Set<string>();
	return scripts.map((script) => {
		const folder = dirname(relative(scriptsDir, script)).replaceAll("\\", "/");
		const prefix = folder === "." || folder.startsWith("..") || isAbsolute(folder) ? "" : `${folder}/`;
		const base = prefix + testFileName(script).replace(/\.test\.ts$/, "");
		let name = `${base}.test.ts`;
		for (let n = 2; taken.has(name); n++) name = `${base}-${n}.test.ts`;
		taken.add(name);
		return name;
	});
}

/** The skeleton test for `script`, to be written in `testsDir`. */
export function starterTest(script: string, testsDir: string): string {
	const file = relative(testsDir, script).replaceAll("\\", "/");
	return `import { sim } from "@tasermonkey/ic10-bench";
import { describe, expect, it } from "vitest";

// TODO: a skeleton test from \`ic10-bench init\`. Add the devices the script uses, wire them to its
// pins, add real checks, then remove \`.skip\`. A walkthrough of a first test:
// https://github.com/tasermonkey/ic10-bench/blob/main/packages/ic10-bench/TUTORIAL.md
describe(${JSON.stringify(scriptName(script))}, () => {
	it.skip("runs without an error", async () => {
		const world = await sim({ root: import.meta.dirname })
			// .device("sensor", "StructureGasSensor")   one for each device the script uses
			.housing("ic", { file: ${JSON.stringify(file)}, pins: {} }) // e.g. pins: { d0: "sensor" }
			.build();

		await world.runTicks(20);

		expect(world.chip("ic")).toHaveNoErrors();
	});
});
`;
}
