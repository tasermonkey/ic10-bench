/**
 * Per-chip declarations: the parts of a script that belong to each chip running it, which
 * ic10-link leaves as each chip has them. A script declares them, once for every chip:
 *
 * - a define, with a comment starting `link-per-chip` on its line (its value is each chip's):
 *       define ROOM_LIGHT HASH("Room Light") # link-per-chip
 * - a block, between two lines marked `link-per-chip {` and `link-per-chip }` (the lines between
 *   them are each chip's, as many as it has; the marked lines, its anchors, are the script's):
 *       push 0 # link-per-chip {
 *       push HASH("StructureLightLong")
 *       poke 0 sp # link-per-chip }
 * - or either in `<script>.json` beside the script, for a script that shouldn't carry the markers:
 *       { "perChip": { "byDefineName": ["ROOM_LIGHT"], "byBlock": [{ "from": "push 0", "to": "poke 0 sp" }] } }
 *
 * The declarations live here, below ic10-link, so lint sees a script's blocks (`per-chip-block`,
 * `per-chip-jump`); what's done with them when sending and pulling is ic10-link's.
 */
import { readFileSync } from "node:fs";
import { parseScript, type Script, type SourceLine } from "./source.ts";

/** What a per-chip comment starts with. */
export const PER_CHIP_MARKER = "link-per-chip";
const MARKER = new RegExp(`^#\\s*${PER_CHIP_MARKER}\\s*([{}])?(?=\\s|$)`);
const DEFINE_NAME = /^[A-Za-z_]\w*$/;

/** A block's anchors, by their code: where it starts and where it ends. */
export interface BlockAnchors {
	from: string;
	to: string;
}

/** A per-chip block found in a text: its anchors' lines (0-based); the lines between them are each chip's. */
export interface PerChipBlock extends BlockAnchors {
	start: number;
	end: number;
}

/** Something wrong with a script's per-chip declarations, on a line (0-based). */
export interface PerChipProblem {
	line: number;
	message: string;
}

/** A per-script file as it's read: all of it, its `perChip` declarations, and its `host`. */
export interface PerChipFile {
	json: Record<string, unknown>;
	names: string[];
	blocks: BlockAnchors[];
	/**
	 * The prefab of the device the script runs in, for one that holds several chips (an extension's
	 * device kind): IC10 Bench's idle check runs the script there. Undefined: a circuit housing.
	 */
	host?: string;
}

/** A script's per-script file, beside it: `<script>.json`. */
export function perChipFile(script: string): string {
	return `${script}.json`;
}

/** A line's code as anchors match it: its tokens, one space apart. */
function codeOf(line: SourceLine): string {
	return line.tokens.join(" ");
}

/** A line of code as an anchor: as `codeOf` reads it, so spacing and a comment don't count. */
export function anchorCode(code: string): string {
	const line = parseScript(code).lines[0];
	return line ? codeOf(line) : "";
}

/** The marker a line's comment starts with: "" for a define's, "{" or "}" for a block's; undefined for none. */
function markerOf(line: SourceLine): "" | "{" | "}" | undefined {
	if (line.commentAt < 0) return undefined;
	const match = MARKER.exec(line.text.slice(line.commentAt));
	return match ? ((match[1] ?? "") as "" | "{" | "}") : undefined;
}

const parsed = (text: Script | string) => (typeof text === "string" ? parseScript(text) : text);

/** The names of the defines whose comment starts with the marker (not a block's). */
export function markedDefines(text: Script | string): string[] {
	const { lines, defines } = parsed(text);
	return defines.filter(({ line }) => markerOf(lines[line]!) === "").map(({ name }) => name);
}

/**
 * A per-script file; throws, with its name (`name`, else `file`), for a bad one. `perChip` and
 * each of its lists are optional.
 */
export function readPerChipFile(file: string, name = file): PerChipFile {
	let json: unknown;
	try {
		json = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(`${name}: not valid JSON (${(error as Error).message})`);
	}
	const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
	if (!isObject(json)) throw new Error(`${name}: must be an object`);
	const perChip = json.perChip ?? {};
	if (!isObject(perChip)) throw new Error(`${name}: "perChip" must be an object`);
	const names = perChip.byDefineName ?? [];
	if (!Array.isArray(names) || !names.every((n) => typeof n === "string" && DEFINE_NAME.test(n))) {
		throw new Error(`${name}: "perChip.byDefineName" must be a list of define names`);
	}
	const blocks = perChip.byBlock ?? [];
	const isAnchor = (value: unknown) => typeof value === "string" && anchorCode(value) !== "";
	if (!Array.isArray(blocks) || !blocks.every((b) => isObject(b) && isAnchor(b.from) && isAnchor(b.to))) {
		throw new Error(`${name}: "perChip.byBlock" must be a list of { "from": <a line of code>, "to": <a line of code> }`);
	}
	const host = json.host;
	if (host !== undefined && (typeof host !== "string" || host === "")) throw new Error(`${name}: "host" must be a prefab name`);
	return {
		json,
		names,
		blocks: blocks.map((b) => ({ from: b.from as string, to: b.to as string })),
		...(host !== undefined && { host }),
	};
}

/**
 * Finds each block in a text, in order, each after the one before: its start, the first line whose
 * code is `from` (one marked `link-per-chip {` first, if there is one), then its end, the first
 * line after that whose code is `to` (one marked `}` first). Undefined for a block not found, as in
 * a chip whose anchor was edited away in game.
 */
export function locateBlocks(text: Script | string, anchors: readonly BlockAnchors[]): (PerChipBlock | undefined)[] {
	const { lines } = parsed(text);
	let after = 0;
	return anchors.map((anchor) => {
		const from = anchorCode(anchor.from);
		const to = anchorCode(anchor.to);
		const find = (code: string, marker: "{" | "}", at: number) => {
			const candidates = lines.slice(at).filter((line) => codeOf(line) === code);
			return (candidates.find((line) => markerOf(line) === marker) ?? candidates[0])?.index;
		};
		const start = find(from, "{", after);
		const end = start === undefined ? undefined : find(to, "}", start + 1);
		if (start === undefined || end === undefined) return undefined;
		after = end + 1;
		return { from, to, start, end };
	});
}

/**
 * A script's per-chip blocks: those its markers make, and those its per-script file declares
 * (`declared`), in order; and what's wrong with them (a marker without its pair, or on a line with
 * no code, blocks that nest or overlap, a declared block the script doesn't have).
 */
export function perChipBlocks(text: Script | string, declared: readonly BlockAnchors[] = []): { blocks: PerChipBlock[]; problems: PerChipProblem[] } {
	const script = parsed(text);
	const blocks: PerChipBlock[] = [];
	const problems: PerChipProblem[] = [];
	let open: SourceLine | undefined;
	for (const line of script.lines) {
		const marker = markerOf(line);
		if (marker !== "{" && marker !== "}") continue;
		if (line.tokens.length === 0) {
			problems.push({ line: line.index, message: `a per-chip block's marker goes on a line of code, so a chip's copy without the marker is still matched by its code` });
			continue;
		}
		if (marker === "{") {
			if (open) problems.push({ line: line.index, message: `starts a per-chip block inside the one started on line ${open.index}` });
			else open = line;
		} else if (!open) {
			problems.push({ line: line.index, message: `ends a per-chip block that wasn't started (# ${PER_CHIP_MARKER} {)` });
		} else {
			blocks.push({ from: codeOf(open), to: codeOf(line), start: open.index, end: line.index });
			open = undefined;
		}
	}
	if (open) problems.push({ line: open.index, message: `starts a per-chip block that doesn't end (# ${PER_CHIP_MARKER} })` });

	for (const [i, block] of locateBlocks(script, declared).entries()) {
		const { from, to } = declared[i]!;
		if (!block) problems.push({ line: 0, message: `the per-script file's block from "${from}" to "${to}" isn't in the script` });
		else if (!blocks.some((b) => b.start === block.start && b.end === block.end)) blocks.push(block);
	}
	blocks.sort((a, b) => a.start - b.start);
	for (const [i, block] of blocks.entries()) {
		const before = blocks[i - 1];
		if (before && block.start <= before.end) problems.push({ line: block.start, message: `a per-chip block overlaps the one on lines ${before.start}-${before.end}` });
	}
	return { blocks, problems };
}
