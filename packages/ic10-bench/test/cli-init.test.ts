import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEV_PACKAGES, type InitIo, type InitOptions, initProject, npmCommand, packageName } from "../src/cli/init.ts";
import { starterTest, testFileName, testFileNames } from "../src/cli/starter-test.ts";
import { sim } from "../src/index.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "ic10-bench-init-"));
	vi.stubEnv("STATIONEERS_DIR", join(root, "no-game")); // no game: no descriptions, no workshop
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

/** Files by path relative to `root`; objects are written as JSON. */
function write(files: Record<string, string | object>) {
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content, null, "\t"));
	}
}
const read = (path: string) => readFileSync(join(root, path), "utf8");
const readJson = (path: string) => JSON.parse(read(path));

/** Every file under `root` but the catalogue's, with its contents. */
function snapshot(dir = root): Record<string, string> {
	const files: Record<string, string> = {};
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) Object.assign(files, entry.name === ".ic10-bench" ? {} : snapshot(full));
		else if (entry.name !== "ic10-bench-env.d.ts") files[relative(root, full)] = readFileSync(full, "utf8");
	}
	return files;
}

/** Runs init with a stand-in npm that adds the packages to package.json, as npm install would. */
async function init(options: InitOptions = {}, io: Partial<InitIo> = {}) {
	const lines: string[] = [];
	const installs: string[][] = [];
	const install = (args: string[], cwd: string) => {
		installs.push(args);
		const json = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
		json.devDependencies = Object.fromEntries(args.filter((a) => !a.startsWith("-") && a !== "install").map((spec) => [spec.replace(/(.)@.*$/, "$1"), "1"]));
		writeFileSync(join(cwd, "package.json"), JSON.stringify(json, null, "\t"));
		return true;
	};
	const done = await initProject(root, options, { out: (line) => lines.push(line), install, ...io });
	return { done, lines, installs };
}

describe("ic10-bench init", () => {
	it("sets up a folder of scripts: package.json, Vitest, TypeScript, git, the packages, the catalogue, lint, and a test per script", async () => {
		write({ "Airlock [448].ic10": "yield", "thermostat.ic10": "yield", "archive/old.ic10": "yield" });
		const { done, lines, installs } = await init();

		expect(done).toBe(true);
		expect(readJson("package.json")).toMatchObject({
			name: packageName(root),
			private: true,
			type: "module",
			scripts: { pretest: "ic10-bench catalog", test: "vitest run", "test:watch": "vitest", lint: "ic10-bench lint" },
		});
		expect(read("vitest.config.ts")).toContain('defineIc10Config({ test: { include: ["tests/**/*.test.ts"] } })');
		expect(readJson("tsconfig.json").include).toEqual(["tests", "ic10-bench-env.d.ts", "vitest.config.ts"]);
		expect(read(".gitignore").split("\n")).toEqual(expect.arrayContaining(["node_modules/", ".ic10-bench/", "ic10-bench-env.d.ts"]));
		expect(installs).toEqual([["install", "--save-dev", ...DEV_PACKAGES]]);
		expect(existsSync(join(root, ".ic10-bench", "catalog.json"))).toBe(true);
		expect(readJson("ic10-lint.json").dir).toBe(".");
		// Top-level scripts only: archive/ is left out.
		expect(readdirSync(join(root, "tests")).sort()).toEqual(["airlock-448.test.ts", "thermostat.test.ts"]);
		expect(read("tests/airlock-448.test.ts")).toBe(starterTest(join(root, "Airlock [448].ic10"), join(root, "tests")));
		expect(lines).toContain("init: wrote 2 skeleton tests in tests/ (skipped until you fill them in)");
		expect(lines.at(-1)).toBe("init: done. Run npm test");
	});

	it("changes nothing when run again", async () => {
		write({ "thermostat.ic10": "yield" });
		await init();
		const before = snapshot();
		const { lines, installs } = await init();

		expect(snapshot()).toEqual(before);
		expect(installs).toEqual([]);
		expect(lines.filter((line) => line.startsWith("init:") && !line.startsWith("init: done"))).toEqual([
			"init: skipped package.json: already set up",
			"init: skipped vitest.config.ts: already there",
			"init: skipped tsconfig.json: already there",
			"init: skipped .gitignore: already set up",
			"init: skipped npm install: the packages are already there",
			"init: skipped ic10-lint.json: already there",
			"init: skipped 1 test in tests/: already there",
		]);
	});

	it("adds to a package.json without changing what's there, and says when the test script isn't Vitest's", async () => {
		write({ "package.json": '{\n  "name": "my-base",\n  "version": "2.0.0",\n  "scripts": {\n    "test": "jest"\n  }\n}\n' });
		const { lines } = await init({ install: false, tests: false });

		const text = read("package.json");
		expect(text).toMatch(/^\{\n {2}"name": "my-base",\n {2}"version": "2.0.0",/); // its indent and key order kept
		expect(JSON.parse(text)).toMatchObject({ type: "module", scripts: { test: "jest", pretest: "ic10-bench catalog", lint: "ic10-bench lint" } });
		expect(lines).toContain("init: updated package.json (type: module; scripts pretest, test:watch, lint)");
		expect(lines).toContain('init: package.json\'s test script is "jest", left as it is; the tests run with "vitest run"');
	});

	it("replaces what npm init -y writes: commonjs, and the test script that fails", async () => {
		write({ "package.json": { name: "base", type: "commonjs", scripts: { test: 'echo "Error: no test specified" && exit 1' } } });
		const { lines } = await init({ install: false, tests: false });

		expect(readJson("package.json")).toMatchObject({ type: "module", scripts: { test: "vitest run" } });
		expect(lines).toContain("init: updated package.json (type: module; scripts pretest, test, test:watch, lint)");
	});

	it('leaves "type": "commonjs" alone when there are .js files it could matter to, with a warning', async () => {
		write({ "package.json": { name: "old", type: "commonjs" }, "tools/build.js": "module.exports = {};" });
		const { lines } = await init({ install: false, tests: false });

		expect(readJson("package.json").type).toBe("commonjs");
		expect(lines.join("\n")).toMatch(/"type": "commonjs" and there are \.js files, so it's left as it is; the tests need "module"/);
	});

	it("adds only the .gitignore lines that are missing", async () => {
		write({ ".gitignore": "node_modules\ncoverage/" });
		const { lines } = await init({ install: false, tests: false });

		expect(read(".gitignore")).toBe(
			"node_modules\ncoverage/\n# Built by `ic10-bench catalog`; they hold the game's own text, so they aren't committed\n.ic10-bench/\nic10-bench-env.d.ts\n",
		);
		expect(lines).toContain("init: added 2 lines to .gitignore");
	});

	it("keeps a Vite or Vitest config that's already there", async () => {
		write({ "vite.config.mjs": "export default {};\n" });
		const { lines } = await init({ install: false, tests: false });

		expect(existsSync(join(root, "vitest.config.ts"))).toBe(false);
		expect(lines).toContain("init: skipped vitest.config.ts: already there");
	});

	it("takes scripts from ic10/ and its subfolders when there is one, with tests in the same subfolders", async () => {
		write({ "ic10/vent.ic10": "yield", "ic10/rooms/lights.ic10": "yield", "ic10/rooms/vent.ic10": "yield", "loose.ic10": "yield" });
		await init({ install: false });

		expect(readdirSync(join(root, "tests"), { recursive: true }).map((p) => String(p).replaceAll("\\", "/")).sort()).toEqual([
			"rooms",
			"rooms/lights.test.ts",
			"rooms/vent.test.ts",
			"vent.test.ts",
		]);
		expect(read("tests/rooms/lights.test.ts")).toContain('file: "../../ic10/rooms/lights.ic10"');
		expect(read("tests/vent.test.ts")).toContain('file: "../ic10/vent.ic10"');
		expect(readJson("ic10-lint.json").dir).toBe("ic10");
	});

	it("takes scripts from --dir, or just the ones named", async () => {
		write({ "scripts/a.ic10": "yield", "scripts/b.ic10": "yield", "c.ic10": "yield" });
		await init({ install: false, dir: "scripts", scripts: ["scripts/b.ic10"] });
		expect(readdirSync(join(root, "tests"))).toEqual(["b.test.ts"]);
		expect(readJson("ic10-lint.json").dir).toBe("scripts");

		await init({ install: false, dir: "scripts" });
		expect(readdirSync(join(root, "tests")).sort()).toEqual(["a.test.ts", "b.test.ts"]);
	});

	it("says so when there are no scripts", async () => {
		const { done, lines } = await init({ install: false });
		expect(done).toBe(true);
		expect(lines).toContain("init: no .ic10 scripts found, so no tests written; run init <file.ic10> once there are some");
	});

	it("stops when npm install fails, before the catalogue", async () => {
		const { done, lines } = await init({}, { install: () => false });
		expect(done).toBe(false);
		expect(lines.at(-1)).toBe("init: npm install failed (above). Fix that and run init again.");
		expect(existsSync(join(root, ".ic10-bench"))).toBe(false);
	});

	describe("in what looks like the game's folder", () => {
		const game = () => {
			root = join(root, "Stationeers", "chipdata");
			mkdirSync(root, { recursive: true });
			write({ "Script1 [450].ic10": "yield" });
		};

		it("stops without a terminal to ask in, unless --yes", async () => {
			game();
			const { done, lines } = await init({ install: false });
			expect(done).toBe(false);
			expect(lines.at(-1)).toBe("init: stopped. Run it again with --yes to set up here anyway.");
			expect(readdirSync(root)).toEqual(["Script1 [450].ic10"]);

			expect((await init({ install: false, yes: true })).done).toBe(true);
		});

		it("asks, and goes on only on a yes", async () => {
			game();
			const questions: string[] = [];
			expect((await init({ install: false }, { ask: async (q) => (questions.push(q), false) })).done).toBe(false);
			expect(existsSync(join(root, "package.json"))).toBe(false);
			expect((await init({ install: false }, { ask: async () => true })).done).toBe(true);
			expect(questions).toEqual(["Set up tests here anyway?"]);
		});
	});
});

describe("npm for init", () => {
	it("runs the npm that started it (npx, npm exec), else npm from the PATH, through a shell on Windows", () => {
		expect(npmCommand({ npm_execpath: "C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" }, "win32")).toEqual({
			command: process.execPath,
			args: ["C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"],
			shell: false,
		});
		expect(npmCommand({}, "win32")).toEqual({ command: "npm", args: [], shell: true });
		expect(npmCommand({ npm_execpath: "/usr/lib/node_modules/yarn/bin/yarn.js" }, "linux")).toEqual({ command: "npm", args: [], shell: false });
	});
});

describe("skeleton tests", () => {
	const FIXTURE = join(import.meta.dirname, "fixtures", "init");

	it("names a test after its script", () => {
		expect(testFileName("Integrated Circuit (IC10) [448].ic10")).toBe("integrated-circuit-ic10-448.test.ts");
		expect(testFileName("[].ic10")).toBe("script.test.ts");
		const ic10 = join(root, "ic10");
		const scripts = ["Vent.ic10", "VENT!.ic10", "rooms/vent.ic10", "rooms/deep/Lights.ic10", "../loose.ic10"].map((p) => join(ic10, p));
		expect(testFileNames(scripts, ic10)).toEqual(["vent.test.ts", "vent-2.test.ts", "rooms/vent.test.ts", "rooms/deep/lights.test.ts", "loose.test.ts"]);
	});

	// The fixture is a skeleton as init writes it, so typecheck checks the code compiles.
	it("matches the fixture", () => {
		const script = join(FIXTURE, "Counter [450].ic10");
		expect(starterTest(script, join(FIXTURE, "tests"))).toBe(readFileSync(join(FIXTURE, "tests", "counter-450.test.ts"), "utf8").replace(/\r\n/g, "\n"));
		expect(statSync(script).isFile()).toBe(true);
	});

	it("runs once .skip is removed, for a script with nothing on its pins", async () => {
		const world = await sim({ root: join(FIXTURE, "tests") })
			.housing("ic", { file: "../Counter [450].ic10", pins: {} })
			.build();

		await world.runTicks(20);

		expect(world.chip("ic")).toHaveNoErrors();
		expect(world.chip("ic")).toHaveRegister("r0", 20);
	});
});
