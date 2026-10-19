/**
 * One pass over a station's mapped chips. Each chip's text and its script's are compared with what
 * they last both had (`state.ts`):
 *
 * - only the script changed: it's checked (`gate.ts`) and, if it passes, written to the chip's
 *   file, which the IC10Sync mod loads into the chip;
 * - only the chip changed (edited in game): its code is written to the script, so it shows up as a
 *   change in git, then checked, to report on (it's already running in game, so nothing to block);
 * - both changed: the script wins, as if only it had; the game's code is kept in
 *   `.ic10-link/preserved/<station>/conflicts/` first;
 * - neither: nothing to do.
 *
 * A chip with no record yet gets its script, since mapping it said it should run it; whatever it
 * had is kept in `.ic10-link/preserved/<station>/backups/` first. A chip emptied in game isn't copied to its script.
 *
 * A script's per-chip defines' values and blocks' lines (`per-chip.ts`) don't count as a change
 * either way: a chip keeps its own when sent the script, and the script keeps its own when sent a
 * chip's edit. A chip without one of the script's blocks gets the script's (its code kept in
 * `backups/` first); its edit in game isn't pulled (kept in `conflicts/`). What a chip is sent is
 * checked against the game's limits too, since its own lines can take it over.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { styleText } from "node:util";
import { type Chip, listChips, type Station } from "../game/chipdata.ts";
import { loadStation } from "../project/stations.ts";
import { checkScript, type GateOptions, type GateResult, overLimits } from "./gate.ts";
import { hasPerChip, maskPerChip, type PerChip, perChipOf, perChipValues, withPerChip } from "./per-chip.ts";
import { loadState, saveState, STATE_DIR, textHash } from "./state.ts";
import { gameText } from "./text.ts";

export type OutcomeKind =
	/** The script passed its checks and was written to the chip's file. */
	| "deployed"
	/** The script changed, but failed its checks; the chip keeps its code. */
	| "blocked"
	/** The chip was edited in game, and its code was written to the script. */
	| "pulled"
	/** The chip was emptied in game; its script was left as it is. */
	| "emptied"
	/** The chip was edited in game, but without one of its script's per-chip blocks; its script was left as it is. */
	| "not pulled"
	/** Chip and script are the same. */
	| "in sync"
	/** The chip was relabelled and has several files; `ic10-link status` picks one. */
	| "several files"
	/** The game has no file for the chip. */
	| "not in game"
	/** The map names a script the project doesn't have. */
	| "no script";

export interface Outcome {
	id: string;
	script: string;
	kind: OutcomeKind;
	/** `pulled`: the code from the game failed its checks. */
	failed?: boolean;
	/** Both had changed: where the game's code was kept, relative to the project. */
	conflict?: string;
}

/** What a `watch` keeps between passes, so it doesn't check or say the same thing twice. */
export interface Session {
	/** Checks done, by script and its text's hash. */
	gates: Map<string, GateResult>;
	/** By chip id, what was last said about it. */
	said: Map<string, string>;
}

export function newSession(): Session {
	return { gates: new Map(), said: new Map() };
}

export interface SyncOptions extends Omit<GateOptions, "root"> {
	/** The project. */
	root: string;
	station: Station;
	log: (line: string) => void;
	session?: Session;
	/** Colour the station's name in what's logged. */
	color?: boolean;
}

/** The station's name, magenta when `color`, so it stands out from the paths around it. */
export function stationLabel(name: string, color: boolean | undefined): string {
	return color ? styleText("magenta", name, { validateStream: false }) : name;
}

/** Where chips' code is preserved, in `.ic10-link/`: one folder, so it can be cleared in one go. */
export const PRESERVED_DIR = `${STATE_DIR}/preserved`;

/** Preserves a chip's code in `.ic10-link/preserved/<station>/<kind>/<its file's name>`; returns that path, relative to the project. */
function preserve(root: string, kind: "backups" | "conflicts", station: Station, chip: Chip, text: string): string {
	const path = `${PRESERVED_DIR}/${station.name}/${kind}/${basename(chip.path)}`;
	const file = join(root, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, text);
	return path;
}

/** One pass: sends changed scripts to their chips, and brings chips edited in game back to their scripts. */
export async function syncOnce(options: SyncOptions): Promise<Outcome[]> {
	const { root, station, log } = options;
	const session = options.session ?? newSession();
	const map = loadStation(root, station.name);
	const state = loadState(root);
	const bases = (state[station.name] ??= {});
	const files = Map.groupBy(listChips(station), (chip) => chip.id);
	const outcomes: Outcome[] = [];
	const where = stationLabel(station.name, options.color);

	/** Says `lines` about the chip, unless the same was last said about it (`key`). */
	const say = (id: string, key: string, lines: string[]) => {
		if (session.said.get(id) === key) return;
		session.said.set(id, key);
		for (const line of lines) log(line);
	};

	/** The script's checks, once per script and text, however many chips run it. */
	const check = async (file: string, script: string, hash: string) => {
		const key = `${script}\0${hash}`;
		let gate = session.gates.get(key);
		if (!gate) {
			gate = await checkScript(file, { ...options, root });
			session.gates.set(key, gate);
		}
		return gate;
	};

	for (const [id, { script }] of Object.entries(map.chips)) {
		const file = resolve(root, script);
		const chips = files.get(id) ?? [];
		if (!existsSync(file)) {
			say(id, "no script", [`[${id}] ${script}: no such script`]);
			outcomes.push({ id, script, kind: "no script" });
			continue;
		}
		if (chips.length !== 1) {
			const kind = chips.length === 0 ? "not in game" : "several files";
			say(id, kind, [
				chips.length === 0
					? `[${id}] not in game yet: the game writes its file once the station is loaded with the chip in it`
					: `[${id}] has ${chips.length} files; skipped until ic10-link status picks the current one`,
			]);
			outcomes.push({ id, script, kind });
			continue;
		}
		const chip = chips[0]!;
		const name = `[${id}] ${chip.label}`;
		const scriptText = gameText(readFileSync(file, "utf8"));
		const chipText = gameText(readFileSync(chip.path, "utf8"));
		// Compared, and recorded, but for the script's per-chip values and lines (per-chip.ts).
		let perChip: PerChip;
		try {
			perChip = perChipOf(file, scriptText);
		} catch (error) {
			const message = (error as Error).message;
			say(id, `per-chip:${message}`, [`${name}: skipped: ${message}`]);
			outcomes.push({ id, script, kind: "blocked" });
			continue;
		}
		const scriptHash = textHash(maskPerChip(scriptText, perChip));
		const chipHash = textHash(maskPerChip(chipText, perChip));
		const chipValues = perChipValues(chipText, perChip);
		// The first of the script's blocks the chip doesn't have (its anchors edited away, or a new chip).
		const lost = perChip.blocks.find((_, i) => chipValues.blocks[i] === undefined);
		const base = bases[id];

		if (scriptHash === chipHash) {
			bases[id] = scriptHash;
			session.said.set(id, "in sync");
			outcomes.push({ id, script, kind: "in sync" });
			continue;
		}
		const scriptChanged = scriptHash !== base;
		const chipChanged = base !== undefined && chipHash !== base;

		if (chipChanged && !scriptChanged) {
			if (chipText === "") {
				say(id, `emptied:${chipHash}`, [`${where}/${name}: emptied in game; ${script} left as it is`]);
				outcomes.push({ id, script, kind: "emptied" });
				continue;
			}
			if (lost) {
				// Its own block can't be told from the rest, so pulling would make it every chip's.
				const kept = preserve(root, "conflicts", station, chip, chipText);
				say(id, `not pulled:${chipHash}`, [
					`${where}/${name}: edited in game, but its per-chip block from "${lost.from}" to "${lost.to}" isn't in it any more; not copied to ${script}, its code is kept in ${kept}`,
				]);
				outcomes.push({ id, script, kind: "not pulled" });
				continue;
			}
			// With the script's per-chip values and lines: one chip's aren't every chip's.
			const pulled = withPerChip(chipText, perChip, perChipValues(scriptText, perChip));
			writeFileSync(file, `${pulled}\n`);
			bases[id] = chipHash;
			const gate = await check(file, script, textHash(pulled));
			say(
				id,
				`pulled:${chipHash}`,
				gate.ok
					? [`${where}/${name} -> ${script} (edited in game; ${gate.report.join("; ")})`]
					: [`${where}/${name} -> ${script} (edited in game), and it fails its checks:`, ...gate.report.map((line) => `  ${line}`)],
			);
			outcomes.push({ id, script, kind: "pulled", ...(gate.ok ? {} : { failed: true }) });
			continue;
		}

		// The script changed (and maybe the chip too): send it, if it passes its checks.
		let conflict: string | undefined;
		if (chipChanged) {
			conflict = preserve(root, "conflicts", station, chip, chipText);
			// Said apart from the rest about the chip, which may follow it (sent, or not).
			say(`${id} conflict`, `${scriptHash}:${chipHash}`, [`${where}/${name}: changed both in game and in ${script}; the game's code is kept in ${conflict}`]);
		}
		const gate = await check(file, script, textHash(scriptText));
		if (!gate.ok) {
			say(id, `blocked:${scriptHash}:${chipHash}`, [`${name}: not sent, ${script} failed its checks:`, ...gate.report.map((line) => `  ${line}`)]);
			outcomes.push({ id, script, kind: "blocked", ...(conflict ? { conflict } : {}) });
			continue;
		}
		// With the chip's own per-chip values and lines, where it has them.
		const sent = withPerChip(scriptText, perChip, chipValues);
		const over = hasPerChip(perChip) ? await overLimits(root, script, sent) : [];
		if (over.length > 0) {
			say(id, `over:${scriptHash}:${chipHash}`, [`${name}: not sent, with its own per-chip lines it's over the game's limits:`, ...over.map((line) => `  ${line}`)]);
			outcomes.push({ id, script, kind: "blocked", ...(conflict ? { conflict } : {}) });
			continue;
		}
		if (chipText !== "" && (base === undefined || lost)) {
			const kept = preserve(root, "backups", station, chip, chipText);
			log(
				lost
					? `${name}: its per-chip block from "${lost.from}" to "${lost.to}" isn't in it, so it gets the script's; its code before is kept in ${kept}`
					: `${name}: its code before is kept in ${kept}`,
			);
		}
		writeFileSync(chip.path, sent);
		bases[id] = scriptHash;
		say(id, `deployed:${scriptHash}`, [`${script} -> ${where}/${name} (${gate.report.join("; ")})`]);
		outcomes.push({ id, script, kind: "deployed", ...(conflict ? { conflict } : {}) });
	}

	saveState(root, state);
	return outcomes;
}
