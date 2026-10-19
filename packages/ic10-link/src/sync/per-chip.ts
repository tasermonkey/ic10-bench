/**
 * What a pass does with a script's per-chip declarations (ic10-lint's `per-chip.ts`): defines whose
 * value, and blocks whose lines, belong to each chip that runs the script, like Room Lights'
 * `ROOM_LIGHT`, one room per chip, or a list it pushes to the stack, as long as each chip needs.
 *
 *     define ROOM_LIGHT HASH("Room Light") # link-per-chip
 *     push 0 # link-per-chip {
 *     push HASH("StructureWallLight")
 *     poke 0 sp # link-per-chip }
 *     { "perChip": { "byDefineName": ["ROOM_LIGHT"], "byBlock": [{ "from": "push 0", "to": "poke 0 sp" }] } }
 *
 * A pass compares chip and script with those values and lines masked, sends the script with each
 * chip's own, and pulls a chip's edit with the script's, so one chip's never becomes every chip's.
 * Texts in and out are `gameText`'s.
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
	anchorCode,
	type BlockAnchors,
	locateBlocks,
	markedDefines,
	type PerChipFile,
	parseScript,
	perChipBlocks,
	perChipFile,
	readPerChipFile,
} from "@tasermonkey/ic10-lint";

const DEFINE_NAME = /^[A-Za-z_]\w*$/;

/** A script's per-chip declarations: its defines' names, and its blocks' anchors, in order. */
export interface PerChip {
	names: string[];
	blocks: BlockAnchors[];
}

/** What a text has for a script's per-chip declarations. */
export interface PerChipValues {
	/** Each define's value; a name the text doesn't define is left out. */
	defines: Map<string, string>;
	/** Each block's lines, between its anchors; undefined for a block not found in the text. */
	blocks: (string[] | undefined)[];
}

/** Whether a script has anything per-chip. */
export function hasPerChip(perChip: PerChip): boolean {
	return perChip.names.length > 0 || perChip.blocks.length > 0;
}

/**
 * The script's per-chip declarations: its markers, then its per-script file's. `script` is the
 * script's path, `text` its `gameText`. Throws, with the file's name, for a bad per-script file.
 * A block that's wrong (a marker without its pair) is left out; lint's `per-chip-block` reports it.
 */
export function perChipOf(script: string, text: string): PerChip {
	const file = perChipFile(script);
	const declared: PerChipFile = existsSync(file) ? readPerChipFile(file) : { json: {}, names: [], blocks: [] };
	const names = [...new Set([...markedDefines(text), ...declared.names])];
	const blocks = perChipBlocks(text, declared.blocks).blocks.map(({ from, to }) => ({ from, to }));
	return { names, blocks };
}

/** The per-script file's JSON, or a new one; throws for a bad file. */
function perScriptJson(script: string): PerChipFile {
	const file = perChipFile(script);
	return existsSync(file) ? readPerChipFile(file) : { json: {}, names: [], blocks: [] };
}

function writePerScript(script: string, json: Record<string, unknown>): void {
	writeFileSync(perChipFile(script), `${JSON.stringify(json, null, "\t")}\n`);
}

/**
 * Adds names to the script's per-script file (`perChip.byDefineName`), making the file if it has
 * none and keeping whatever else it has; returns the names it added (not those already listed).
 * Throws for a name that can't be a define's, or a bad file.
 */
export function addPerChipNames(script: string, names: readonly string[]): string[] {
	for (const name of names) if (!DEFINE_NAME.test(name)) throw new Error(`${name}: not a define name`);
	const { json, names: listed } = perScriptJson(script);
	const added = [...new Set(names)].filter((name) => !listed.includes(name));
	if (added.length === 0) return [];
	json.perChip = { ...(json.perChip as object | undefined), byDefineName: [...listed, ...added] };
	writePerScript(script, json);
	return added;
}

/**
 * Adds a block to the script's per-script file (`perChip.byBlock`), by its anchors' code, making
 * the file if it has none; false if it already lists it. Throws for a bad file.
 */
export function addPerChipBlock(script: string, anchors: BlockAnchors): boolean {
	const { json, blocks } = perScriptJson(script);
	const block = { from: anchorCode(anchors.from), to: anchorCode(anchors.to) };
	if (blocks.some((b) => anchorCode(b.from) === block.from && anchorCode(b.to) === block.to)) return false;
	json.perChip = { ...(json.perChip as object | undefined), byBlock: [...blocks, block] };
	writePerScript(script, json);
	return true;
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

/** Each block's lines in the text, between its anchors; undefined for a block not found. */
export function blockLines(text: string, blocks: readonly BlockAnchors[]): (string[] | undefined)[] {
	const lines = parseScript(text).lines.map((line) => line.text);
	return locateBlocks(text, blocks).map((found) => found && lines.slice(found.start + 1, found.end));
}

/**
 * The text with each block found in it given `lines(i)` between its anchors, where that gives
 * some; with `anchors`, the anchors become their code too (no comment, so no marker).
 */
function replaceBlocks(text: string, blocks: readonly BlockAnchors[], lines: (i: number) => string[] | undefined, anchors = false): string {
	if (blocks.length === 0) return text;
	const out = parseScript(text).lines.map((line) => line.text);
	const found = locateBlocks(text, blocks);
	// From the last, so each splice leaves the lines of the blocks before it where they were found.
	for (let i = found.length - 1; i >= 0; i--) {
		const block = found[i];
		const replacement = lines(i);
		if (!block || !replacement) continue;
		if (anchors) out.splice(block.start, block.end - block.start + 1, block.from, ...replacement, block.to);
		else out.splice(block.start + 1, block.end - block.start - 1, ...replacement);
	}
	return out.join("\n");
}

/** What the text has for the script's per-chip declarations. */
export function perChipValues(text: string, perChip: PerChip): PerChipValues {
	return { defines: defineValues(text, perChip.names), blocks: blockLines(text, perChip.blocks) };
}

/**
 * The text with its per-chip values masked, to compare two texts but for them: each block's lines
 * as one `*`, and its anchors as their code, so a chip without the markers compares the same.
 */
export function maskPerChip(text: string, perChip: PerChip): string {
	// Blocks first, found by their anchors' code before a define's value on one could change it.
	return maskDefines(replaceBlocks(text, perChip.blocks, () => ["*"], true), perChip.names);
}

/** The text with another's per-chip values: each define and block of `values` that the text has too. */
export function withPerChip(text: string, perChip: PerChip, values: PerChipValues): string {
	return withDefines(replaceBlocks(text, perChip.blocks, (i) => values.blocks[i]), values.defines);
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
