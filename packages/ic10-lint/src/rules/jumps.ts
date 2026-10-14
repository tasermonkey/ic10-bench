import { parseLiteral } from "../numbers.ts";
import { instruction } from "../source.ts";
import type { Rule } from "../types.ts";

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

/**
 * `j 12` or `beqz r0 12` jumps to a line by number, which moves when a line is added above it
 * (comment and blank lines count). A label doesn't. Line 0 is exempt: it's always the start.
 */
export const absoluteJumpNumber: Rule = {
	id: "absolute-jump-number",
	defaultSeverity: "warning",
	description: "A jump or branch to a line number (other than 0) rather than a label",
	check(context) {
		const names = new Set([...context.script.defines, ...context.script.labels].map((d) => d.name));
		for (const line of context.script.lines) {
			const ins = instruction(line);
			if (!ins || !isAbsolute(ins.op)) continue;
			const target = ins.args.at(-1);
			if (target === undefined || names.has(target)) continue;
			const value = parseLiteral(target);
			if (value === undefined || value === 0 || !/^[\d$%]/.test(target)) continue;
			context.report({
				line: line.index,
				column: line.columns.at(-1)!,
				message: `${ins.op} to line ${target} by number: it moves when lines are added above it; jump to a label instead`,
			});
		}
	},
};
