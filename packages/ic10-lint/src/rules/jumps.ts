import { parseLiteral } from "../numbers.ts";
import { instruction } from "../source.ts";
import type { Rule, RuleContext } from "../types.ts";

const isRelative = (op: string) => op === "jr" || op.startsWith("br");
const isAbsolute = (op: string) => op === "j" || op === "jal" || (op.startsWith("b") && !op.startsWith("br"));

/**
 * `brgt r0 r1 loop` takes an offset, so it jumps by the label's line number, not to the label.
 */
export const relativeBranchToLabel: Rule = {
	id: "relative-branch-to-label",
	defaultSeverity: "warning",
	description: "A relative branch (br*, jr) given a label, which it takes as an offset",
	check(context) {
		const labels = new Map(context.script.labels.map((l) => [l.name, l.line]));
		for (const line of context.script.lines) {
			const ins = instruction(line);
			if (!ins || !isRelative(ins.op)) continue;
			const target = ins.args.at(-1);
			if (target === undefined || !labels.has(target)) continue;
			context.report({
				line: line.index,
				column: line.columns.at(-1)!,
				message: `${ins.op} takes an offset, so it jumps by ${target}'s line number (${labels.get(target)}), not to ${target}; use ${ins.op.replace(/^br/, "b").replace(/^jr$/, "j")}`,
			});
		}
	},
};

/** An instruction's last argument as a number written in the script (not a name, a register or 0), or undefined. */
function numberTarget(target: string | undefined, names: Set<string>): number | undefined {
	if (target === undefined || names.has(target)) return undefined;
	const value = parseLiteral(target);
	return value === undefined || value === 0 || !/^-?[\d$%]/.test(target) ? undefined : value;
}

const declaredNames = (context: RuleContext) => new Set([...context.script.defines, ...context.script.labels].map((d) => d.name));

/** The per-chip block an absolute jump to line `target` lands after the start of, which moves it on each chip. */
const blockBefore = (context: RuleContext, target: number) => context.perChip.blocks.find((block) => target > block.start);

/**
 * `j 12` or `beqz r0 12` jumps to a line by number, which moves when a line is added above it
 * (comment and blank lines count). A label doesn't. Line 0 is exempt: it's always the start. A
 * jump past a per-chip block is `per-chip-jump`'s, which says why it's worse there.
 */
export const absoluteJumpNumber: Rule = {
	id: "absolute-jump-number",
	defaultSeverity: "warning",
	description: "A jump or branch to a line number (other than 0) rather than a label",
	check(context) {
		const names = declaredNames(context);
		for (const line of context.script.lines) {
			const ins = instruction(line);
			if (!ins || !isAbsolute(ins.op)) continue;
			const target = ins.args.at(-1);
			const value = numberTarget(target, names);
			if (value === undefined || value < 0 || blockBefore(context, value)) continue;
			context.report({
				line: line.index,
				column: line.columns.at(-1)!,
				message: `${ins.op} to line ${target} by number: it moves when lines are added above it; jump to a label instead`,
			});
		}
	},
};

/**
 * In a script with a per-chip block (`per-chip.ts`), each chip has its own lines between the
 * block's anchors, as many as it has, so every line after the block's start is a different line
 * on each chip. A jump to a line number past it, or a relative branch by a number over it, lands
 * somewhere else on each. A label moves with its line.
 */
export const perChipJump: Rule = {
	id: "per-chip-jump",
	defaultSeverity: "warning",
	description: "A jump to a line number past a per-chip block, or a relative branch by a number across one",
	check(context) {
		if (context.perChip.blocks.length === 0) return;
		const names = declaredNames(context);
		const about = (block: { start: number }) =>
			`the per-chip block starting on line ${block.start} has as many lines as each chip gives it, so it lands on a different line on each; use a label`;
		for (const line of context.script.lines) {
			const ins = instruction(line);
			if (!ins) continue;
			const target = ins.args.at(-1);
			const value = numberTarget(target, names);
			if (value === undefined) continue;
			if (isAbsolute(ins.op)) {
				const block = value > 0 ? blockBefore(context, value) : undefined;
				if (block) context.report({ line: line.index, column: line.columns.at(-1)!, message: `${ins.op} to line ${target} by number: ${about(block)}` });
			} else if (isRelative(ins.op)) {
				const [lo, hi] = [Math.min(line.index, line.index + value), Math.max(line.index, line.index + value)];
				// Over the block's lines, unless both ends are among them (a branch within the chip's own lines).
				const block = context.perChip.blocks.find((b) => lo < b.end && hi > b.start && !(lo > b.start && hi < b.end));
				if (block) context.report({ line: line.index, column: line.columns.at(-1)!, message: `${ins.op} by ${target} lines, across a per-chip block: ${about(block)}` });
			}
		}
	},
};
