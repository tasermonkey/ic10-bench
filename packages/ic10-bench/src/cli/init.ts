/**
 * `ic10-bench init`: sets up a folder of IC10 scripts as a test project, so `npm test` runs:
 * package.json, vitest.config.ts, tsconfig.json, .gitignore, the packages, the catalogue,
 * ic10-lint.json, and a skeleton test per script in tests/ (starter-test.ts).
 *
 * Every step leaves alone what's already there, so running it again changes nothing, and it can
 * finish a project that's half set up.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { CONFIG_FILE, findScripts, initConfig } from "@tasermonkey/ic10-lint";
import pkg from "@tasermonkey/ic10-bench/package.json" with { type: "json" };
import { buildProjectCatalog } from "./catalog.ts";
import { starterTest, testFileNames } from "./starter-test.ts";

export interface InitOptions {
	/** Write skeleton tests for just these scripts (relative to the project). */
	scripts?: string[];
	/** The scripts' folder. Default `ic10/` if there is one, else the project folder (not its subfolders). */
	dir?: string;
	/** Run `npm install`. Default true. */
	install?: boolean;
	/** Write skeleton tests. Default true. */
	tests?: boolean;
	/** Set up in what looks like the game's own folder without asking. */
	yes?: boolean;
}

export interface InitIo {
	out(line: string): void;
	/** Ask a yes/no question; undefined when there's no terminal to ask in. */
	ask?(question: string): Promise<boolean>;
	/** Run npm install with these arguments in `cwd`; true if it worked. */
	install(args: string[], cwd: string): boolean;
}

export const PACKAGE_SCRIPTS = {
	pretest: "ic10-bench catalog",
	test: "vitest run",
	"test:watch": "vitest",
	lint: "ic10-bench lint",
};

/** What `npm install --save-dev` installs: this version of ic10-bench, and what the tests and editor need. */
export const DEV_PACKAGES = [`@tasermonkey/ic10-bench@^${pkg.version}`, "vitest@^5", "@types/node", "typescript"];

const VITEST_CONFIG = `import { defineIc10Config } from "@tasermonkey/ic10-bench/config";

export default defineIc10Config({ test: { include: ["tests/**/*.test.ts"] } });
`;

const TSCONFIG = {
	compilerOptions: {
		target: "esnext",
		module: "nodenext",
		moduleResolution: "nodenext",
		allowImportingTsExtensions: true,
		erasableSyntaxOnly: true,
		verbatimModuleSyntax: true,
		resolveJsonModule: true,
		strict: true,
		skipLibCheck: true,
		noEmit: true,
		types: ["node"],
	},
	include: ["tests", "ic10-bench-env.d.ts", "vitest.config.ts"],
};

const CATALOG_IGNORES = [".ic10-bench/", "ic10-bench-env.d.ts"];
const CATALOG_IGNORES_COMMENT = "# Built by `ic10-bench catalog`; they hold the game's own text, so they aren't committed";

const json = (value: unknown, indent: string = "\t") => `${JSON.stringify(value, null, indent)}\n`;

/** A folder named Stationeers on the path: probably the game's own, which the game and its mods read. */
export function looksLikeGameFolder(root: string): boolean {
	return resolve(root).split(/[\\/]/).some((part) => part.toLowerCase() === "stationeers");
}

/** The folder's name, as npm allows a package name. */
export function packageName(root: string): string {
	return basename(resolve(root)).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|-+$/g, "") || "ic10-scripts";
}

/** The test script `npm init -y` writes. */
const NPM_INIT_TEST = 'echo "Error: no test specified" && exit 1';

/** Any .js file in the project, outside node_modules and dot-folders. */
function hasJsFiles(dir: string): boolean {
	return readdirSync(dir, { withFileTypes: true }).some((entry) =>
		entry.isDirectory()
			? entry.name !== "node_modules" && !entry.name.startsWith(".") && hasJsFiles(join(dir, entry.name))
			: entry.name.endsWith(".js"),
	);
}

function setUpPackageJson(root: string): string[] {
	const file = join(root, "package.json");
	if (!existsSync(file)) {
		const created = { name: packageName(root), private: true, type: "module", scripts: PACKAGE_SCRIPTS, engines: { node: ">=24" } };
		writeFileSync(file, json(created));
		return [`init: wrote package.json (type: module; scripts ${Object.keys(PACKAGE_SCRIPTS).join(", ")})`];
	}
	const text = readFileSync(file, "utf8");
	const existing = JSON.parse(text) as { type?: string; scripts?: Record<string, string> };
	const changes: string[] = [];
	const notes: string[] = [];
	// "type" only changes what .js files mean, so without any it's safe to change (npm init -y writes "commonjs").
	if (existing.type === undefined || (existing.type !== "module" && !hasJsFiles(root))) {
		existing.type = "module";
		changes.push("type: module");
	} else if (existing.type !== "module") {
		notes.push(`init: package.json has "type": "${existing.type}" and there are .js files, so it's left as it is; the tests need "module" and won't run until it's changed`);
	}
	const scripts = existing.scripts ?? {};
	const added = Object.entries(PACKAGE_SCRIPTS).filter(([name]) => scripts[name] === undefined || (name === "test" && scripts.test === NPM_INIT_TEST));
	for (const [name, command] of added) scripts[name] = command;
	if (added.length) {
		existing.scripts = scripts;
		changes.push(`scripts ${added.map(([name]) => name).join(", ")}`);
	}
	if (scripts.test !== PACKAGE_SCRIPTS.test) notes.push(`init: package.json's test script is "${scripts.test}", left as it is; the tests run with "vitest run"`);
	if (!changes.length) return ["init: skipped package.json: already set up", ...notes];
	writeFileSync(file, json(existing, /^([ \t]+)"/m.exec(text)?.[1]));
	return [`init: updated package.json (${changes.join("; ")})`, ...notes];
}

/** Writes `name` unless `exists` finds it there already. */
function writeIfMissing(root: string, name: string, content: string, exists = () => existsSync(join(root, name))): string {
	if (exists()) return `init: skipped ${name}: already there`;
	writeFileSync(join(root, name), content);
	return `init: wrote ${name}`;
}

function hasViteConfig(root: string): boolean {
	return readdirSync(root).some((name) => /^vite(st)?\.config\.[cm]?[jt]s$/.test(name));
}

function setUpGitignore(root: string): string {
	const file = join(root, ".gitignore");
	const text = existsSync(file) ? readFileSync(file, "utf8") : "";
	const present = new Set(text.split(/\r?\n/).map((line) => line.trim().replace(/^\/|\/$/g, "")));
	const missing = (lines: string[]) => lines.filter((line) => !present.has(line.replace(/\/$/, "")));
	const add = [...missing(["node_modules/"]), ...(missing(CATALOG_IGNORES).length ? [CATALOG_IGNORES_COMMENT, ...missing(CATALOG_IGNORES)] : [])];
	if (!add.length) return "init: skipped .gitignore: already set up";
	writeFileSync(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${add.join("\n")}\n`);
	const count = add.filter((line) => !line.startsWith("#")).length;
	return text ? `init: added ${count} ${count === 1 ? "line" : "lines"} to .gitignore` : "init: wrote .gitignore";
}

/** The package's name in an install spec: `@tasermonkey/ic10-bench@^1.2.0` → `@tasermonkey/ic10-bench`. */
const specName = (spec: string) => spec.slice(0, spec.indexOf("@", 1) > 0 ? spec.indexOf("@", 1) : undefined);

/** The packages in DEV_PACKAGES that package.json doesn't depend on yet. */
export function missingPackages(root: string): string[] {
	const { dependencies = {}, devDependencies = {} } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, Record<string, string>>;
	return DEV_PACKAGES.filter((spec) => !(specName(spec) in dependencies) && !(specName(spec) in devDependencies));
}

/** The scripts' folder, and whether to look in its subfolders. */
function scriptFolder(root: string, dir?: string): { dir: string; deep: boolean } {
	if (dir) return { dir: resolve(root, dir), deep: true };
	const ic10 = join(root, "ic10");
	if (existsSync(ic10) && statSync(ic10).isDirectory()) return { dir: ic10, deep: true };
	return { dir: root, deep: false };
}

function scriptsIn({ dir, deep }: { dir: string; deep: boolean }): string[] {
	if (deep) return findScripts(dir);
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ic10"))
		.map((entry) => join(dir, entry.name))
		.sort();
}

function writeTests(root: string, scripts: string[], scriptsDir: string): string[] {
	if (!scripts.length) return ["init: no .ic10 scripts found, so no tests written; run init <file.ic10> once there are some"];
	const testsDir = join(root, "tests");
	const names = testFileNames(scripts, scriptsDir);
	let written = 0;
	scripts.forEach((script, i) => {
		const file = join(testsDir, names[i]!);
		if (existsSync(file)) return;
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, starterTest(script, dirname(file)));
		written++;
	});
	const skipped = scripts.length - written;
	const lines = written ? [`init: wrote ${written} skeleton ${written === 1 ? "test" : "tests"} in tests/ (skipped until you fill them in)`] : [];
	if (skipped) lines.push(`init: skipped ${skipped} ${skipped === 1 ? "test" : "tests"} in tests/: already there`);
	return lines;
}

/** Sets up the project in `root`; false if it stopped before the end. */
export async function initProject(root: string, options: InitOptions, io: InitIo): Promise<boolean> {
	root = resolve(root);
	if (looksLikeGameFolder(root) && !options.yes) {
		io.out(`init: ${root} looks like the game's own folder. A mod reads .ic10 files from it, and init adds node_modules/ (thousands of files) and tests/ beside them.`);
		if (!io.ask) {
			io.out("init: stopped. Run it again with --yes to set up here anyway.");
			return false;
		}
		if (!(await io.ask("Set up tests here anyway?"))) {
			io.out("init: stopped.");
			return false;
		}
	}
	const folder = scriptFolder(root, options.dir);
	for (const line of setUpPackageJson(root)) io.out(line);
	io.out(writeIfMissing(root, "vitest.config.ts", VITEST_CONFIG, () => hasViteConfig(root)));
	io.out(writeIfMissing(root, "tsconfig.json", json(TSCONFIG)));
	io.out(setUpGitignore(root));

	if (options.install !== false) {
		const missing = missingPackages(root);
		if (!missing.length) io.out("init: skipped npm install: the packages are already there");
		else {
			io.out(`init: installing ${missing.join(" ")}`);
			if (!io.install(["install", "--save-dev", ...missing], root)) {
				io.out("init: npm install failed (above). Fix that and run init again.");
				return false;
			}
		}
	}

	for (const line of await buildProjectCatalog(root)) io.out(line);

	if (existsSync(join(root, CONFIG_FILE))) io.out(`init: skipped ${CONFIG_FILE}: already there`);
	else {
		initConfig(root, { dir: relative(root, folder.dir).replaceAll(sep, "/") || "." });
		io.out(`init: wrote ${CONFIG_FILE}`);
	}

	if (options.tests !== false) {
		const scripts = options.scripts ? options.scripts.map((script) => resolve(root, script)) : scriptsIn(folder);
		for (const line of writeTests(root, scripts, folder.dir)) io.out(line);
	}
	io.out("init: done. Run npm test");
	return true;
}

/** How to run npm: through the npm that started us (npx, npm exec) if there is one, else from the PATH. */
export function npmCommand(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { command: string; args: string[]; shell: boolean } {
	const cli = env.npm_execpath;
	if (cli && /npm-cli\.[cm]?js$/.test(cli)) return { command: process.execPath, args: [cli], shell: false };
	return { command: "npm", args: [], shell: platform === "win32" }; // npm.cmd needs a shell on Windows
}

/** Runs npm install, its output going straight to the terminal. */
export function npmInstall(args: string[], cwd: string): boolean {
	const { command, args: pre, shell } = npmCommand();
	// Through a shell, quote each argument: cmd.exe reads the ^ in a version range as an escape.
	const all = shell ? [...pre, ...args].map((arg) => `"${arg}"`) : [...pre, ...args];
	return spawnSync(command, all, { cwd, stdio: "inherit", shell }).status === 0;
}
