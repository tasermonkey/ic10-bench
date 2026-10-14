/**
 * Static check of batch instructions: for `lb`, `lbn`, `lbs`, `lbns`, `sb`, `sbn` and `sbs` whose
 * device type is a known prefab (`HASH("…")`, a number, or a define of either), check that the
 * prefab has the logic type, and that it can be read or written as the instruction does.
 *
 * A type held in a register, or a logic type given as a number, can't be known without running the
 * script, so those are skipped. So are names that aren't logic types at all: the emulator rejects
 * those when it loads the script (the `validate` rule).
 */
import { HashString } from "@tasermonkey/ic10";
import { parseLiteral } from "./numbers.ts";
import { instruction, parseScript, type Script } from "./source.ts";
import type { BatchOpCatalog, LintPrefab } from "./types.ts";

export type BatchOpProblem = "unknown-prefab" | "no-such-property" | "not-readable" | "not-writable" | "no-such-slot-property";

export interface BatchOpFinding {
	/** 0-based line. */
	line: number;
	/** 0-based column of the argument at fault. */
	column: number;
	text: string;
	prefab: string;
	logic: string;
	problem: BatchOpProblem;
	message: string;
}

interface Op {
	type: number;
	logic: number;
	access: "r" | "w";
	slot?: number;
}

/** Argument positions (after the opcode) of each batch instruction. */
export const BATCH_OPS: Record<string, Op> = {
	lb: { type: 1, logic: 2, access: "r" },
	lbn: { type: 1, logic: 3, access: "r" },
	lbs: { type: 1, slot: 2, logic: 3, access: "r" },
	lbns: { type: 1, slot: 3, logic: 4, access: "r" },
	sb: { type: 0, logic: 1, access: "w" },
	sbn: { type: 0, logic: 2, access: "w" },
	sbs: { type: 0, slot: 1, logic: 2, access: "w" },
};

/** A whole number literal (decimal or `$hex`), as the signed 32-bit value prefab hashes are. */
function wholeNumber(token: string): number | undefined {
	if (!/^-?\d+$/.test(token) && !/^\$[0-9A-Fa-f]+$/.test(token)) return undefined;
	return parseLiteral(token)! | 0;
}

export function checkBatchOps(source: string | Script, catalog: BatchOpCatalog): BatchOpFinding[] {
	const script = typeof source === "string" ? parseScript(source) : source;
	const prefabs = Object.values(catalog.prefabs);
	const byHash = new Map(prefabs.map((p) => [p.hash, p]));
	const logicNames = new Set(prefabs.flatMap((p) => Object.keys(p.logic)));
	const slotLogicNames = new Set(prefabs.flatMap((p) => p.slots.flatMap((s) => s.logic)));

	// Defines apply to the whole script, wherever they are.
	const defines = new Map(script.defines.map((d) => [d.name, d.value]));

	/** The prefab a type argument names: its name (known or not) and catalogue entry, if any. */
	const resolve = (token: string, depth = 0): { name: string; prefab?: LintPrefab } | undefined => {
		const hashed = /^HASH\("(.*)"\)$/.exec(token);
		if (hashed) {
			const name = hashed[1]!;
			return { name, prefab: catalog.prefabs[name] ?? byHash.get(new HashString(name).hash) };
		}
		const value = wholeNumber(token);
		if (value !== undefined) {
			const prefab = byHash.get(value);
			return prefab ? { name: prefab.prefab, prefab } : { name: String(value) };
		}
		const defined = defines.get(token);
		return defined !== undefined && depth < 8 ? resolve(defined, depth + 1) : undefined; // a register or alias
	};

	const findings: BatchOpFinding[] = [];
	for (const line of script.lines) {
		const ins = instruction(line);
		const op = ins && BATCH_OPS[ins.op];
		if (!ins || !op) continue;
		const { args } = ins;
		const type = resolve(args[op.type] ?? "");
		const logic = args[op.logic] ?? "";
		if (!type) continue;
		const report = (problem: BatchOpProblem, message: string, at: number) =>
			findings.push({
				line: line.index,
				column: line.columns[at + 1] ?? 0,
				text: line.text.trim(),
				prefab: type.name,
				logic,
				problem,
				message,
			});

		if (!type.prefab) {
			// A number that isn't a prefab hash may be anything; a HASH() of an unknown name is a finding.
			if (/^HASH\(/.test(args[op.type]!) || defines.has(args[op.type]!)) {
				if (Number.isNaN(Number(type.name))) report("unknown-prefab", `no prefab ${type.name} in the catalogue`, op.type);
			}
			continue;
		}
		const prefab = type.prefab;

		if (op.slot !== undefined) {
			if (!slotLogicNames.has(logic)) continue; // not a slot logic type name: the emulator checks
			const slotIndex = wholeNumber(args[op.slot] ?? "");
			const slots = slotIndex === undefined ? prefab.slots : prefab.slots.filter((s) => s.index === slotIndex);
			if (!slots.some((s) => s.logic.includes(logic))) {
				const where = slotIndex === undefined ? "any slot" : `slot ${slotIndex}`;
				report("no-such-slot-property", `${prefab.prefab} has no ${logic} in ${where}`, op.logic);
			}
			continue;
		}

		if (!logicNames.has(logic)) continue; // not a logic type name (a define or a number): the emulator checks
		const access = prefab.logic[logic];
		if (!access) report("no-such-property", `${prefab.prefab} has no ${logic}`, op.logic);
		else if (op.access === "r" && !access.includes("r")) report("not-readable", `${prefab.prefab}.${logic} can't be read`, op.logic);
		else if (op.access === "w" && !access.includes("w")) report("not-writable", `${prefab.prefab}.${logic} is read-only`, op.logic);
	}
	return findings;
}
