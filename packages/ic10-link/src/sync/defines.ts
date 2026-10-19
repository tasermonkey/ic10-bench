/**
 * Per-chip defines: a script's `define`s whose values belong to each chip that runs it, like Room
 * Lights' `ROOM_LIGHT`, one room per chip. The script declares them, once for every chip and every
 * station: a comment starting `link-per-chip` on the define's line, or `<script>.json` beside it.
 *
 *     define ROOM_LIGHT HASH("Room Light") # link-per-chip
 *     { "perChip": { "byDefineName": ["ROOM_LIGHT"] } }
 *
 * A pass compares chip and script with those values masked, sends the script with each chip's own
 * values, and pulls a chip's edit with the script's values, so one chip's value never becomes
 * every chip's. Texts in and out are `gameText`'s.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseScript } from "@tasermonkey/ic10-lint";

/** What a define's comment starts with to make it per-chip. */
export const PER_CHIP_MARKER = "link-per-chip";
const MARKED = new RegExp(`^#\\s*${PER_CHIP_MARKER}(\\s|$)`);
const DEFINE_NAME = /^[A-Za-z_]\w*$/;

/** A script's per-script file, beside it: `<script>.json`. */
export function perChipFile(script: string): string {
	return `${script}.json`;
}

/** The names of the defines whose comment starts with the marker. */
export function markedDefines(text: string): string[] {
	const { lines, defines } = parseScript(text);
	return defines
		.filter(({ line }) => {
			const { text, commentAt } = lines[line]!;
			return commentAt >= 0 && MARKED.test(text.slice(commentAt));
		})
		.map(({ name }) => name);
}

/** A per-script file as it's read: all of it, and `perChip.byDefineName`. */
interface PerChipJson {
	json: Record<string, unknown>;
	names: string[];
}

/** A per-script file; throws, with the file's name, for a bad one. */
function readPerChipFile(file: string): PerChipJson {
	let json: unknown;
	try {
		json = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(`${file}: not valid JSON (${(error as Error).message})`);
	}
	if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error(`${file}: must be an object`);
	const perChip = (json as { perChip?: unknown }).perChip ?? {};
	if (typeof perChip !== "object" || perChip === null || Array.isArray(perChip)) throw new Error(`${file}: "perChip" must be an object`);
	const names = (perChip as { byDefineName?: unknown }).byDefineName ?? [];
	if (!Array.isArray(names) || !names.every((name) => typeof name === "string" && DEFINE_NAME.test(name))) {
		throw new Error(`${file}: "perChip.byDefineName" must be a list of define names`);
	}
	return { json: json as Record<string, unknown>, names };
}

/**
 * Adds names to the script's per-script file (`perChip.byDefineName`), making the file if it has
 * none and keeping whatever else it has; returns the names it added (not those already listed).
 * Throws for a name that can't be a define's, or a bad file.
 */
export function addPerChipNames(script: string, names: readonly string[]): string[] {
	for (const name of names) if (!DEFINE_NAME.test(name)) throw new Error(`${name}: not a define name`);
	const file = perChipFile(script);
	const { json, names: listed } = existsSync(file) ? readPerChipFile(file) : { json: {}, names: [] };
	const added = [...new Set(names)].filter((name) => !listed.includes(name));
	if (added.length === 0) return [];
	json.perChip = { ...(json.perChip as object | undefined), byDefineName: [...listed, ...added] };
	writeFileSync(file, `${JSON.stringify(json, null, "\t")}\n`);
	return added;
}

/**
 * The script's per-chip define names: its marked defines, then its per-script file's. `script` is
 * the script's path, `text` its `gameText`. Throws, with the file's name, for a bad per-script file.
 */
export function perChipNames(script: string, text: string): string[] {
	const names = new Set(markedDefines(text));
	const file = perChipFile(script);
	if (existsSync(file)) for (const name of readPerChipFile(file).names) names.add(name);
	return [...names];
}

/** Each name's value, from its first `define` in the text; a name with none is left out. */
export function defineValues(text: string, names: readonly string[]): Map<string, string> {
	const values = new Map<string, string>();
	for (const { name, value } of parseScript(text).defines) {
		if (names.includes(name) && !values.has(name)) values.set(name, value);
	}
	return values;
}

/** The text with the value of each name's first `define` replaced by `value(name)`, where it gives one. */
function replaceValues(text: string, names: readonly string[], value: (name: string) => string | undefined): string {
	if (names.length === 0) return text;
	const { lines, defines } = parseScript(text);
	const out = lines.map((line) => line.text);
	const done = new Set<string>();
	for (const define of defines) {
		if (!names.includes(define.name) || done.has(define.name)) continue;
		done.add(define.name);
		const replacement = value(define.name);
		if (replacement === undefined) continue;
		// The value is the define's third token: only it changes, so a comment (the marker) stays.
		const line = lines[define.line]!;
		const at = line.columns[2]!;
		out[define.line] = line.text.slice(0, at) + replacement + line.text.slice(at + define.value.length);
	}
	return out.join("\n");
}

/** The text with each named define's value masked, to compare two texts but for those values. */
export function maskDefines(text: string, names: readonly string[]): string {
	return replaceValues(text, names, () => "*");
}

/** The text with each define in `values` given that value; a define the text doesn't have is left out. */
export function withDefines(text: string, values: ReadonlyMap<string, string>): string {
	return replaceValues(text, [...values.keys()], (name) => values.get(name));
}

/**
 * The per-script files under `root` whose script is gone (renamed or moved without them), relative
 * to `root` with `/`, for a project's own test. Skips `node_modules` and folders starting with `.`.
 */
export function checkPerChipFiles(root: string): string[] {
	const orphans: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(path);
			} else if (entry.name.toLowerCase().endsWith(".ic10.json") && !existsSync(path.slice(0, -".json".length))) {
				orphans.push(relative(root, path).replaceAll("\\", "/"));
			}
		}
	};
	walk(root);
	return orphans.sort();
}
