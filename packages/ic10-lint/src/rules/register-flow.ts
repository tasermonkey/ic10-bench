import { instruction } from "../source.ts";
import type { Rule } from "../types.ts";

/** Instructions whose first argument is read (or is a device), not written. */
const NO_RESULT = new Set([
	"s", "sd", "ss", "sb", "sbn", "sbs", "put", "putd", "poke", "push", "clr", "clrd",
	"j", "jal", "jr", "yield", "sleep", "alias", "define", "hcf",
]);

/**
 * Registers read before anything writes them, or written and never read. Off by default: it reads
 * the script top to bottom, not along its jumps, and registers start at 0 (and keep their values
 * across a restart), so a script may rely on either on purpose.
 */
export const registerFlow: Rule = {
	id: "register-flow",
	defaultSeverity: "info",
	defaultOff: true,
	description: "A register read before it's written, or written and never read (off by default)",
	check(context) {
		const { lines, aliases } = context.script;
		const registerOf = new Map<string, string>();
		for (const alias of aliases) if (/^r\d+$/.test(alias.value)) registerOf.set(alias.name, alias.value);
		const register = (token: string): string | undefined => {
			if (/^r(?:1[0-5]|\d)$/.test(token)) return token;
			const indirect = /^r+(\d+)$/.exec(token); // rr3 reads r3
			if (indirect) return `r${indirect[1]}`;
			return registerOf.get(token);
		};

		const written = new Map<string, number>();
		const read = new Set<string>();
		for (const line of lines) {
			const ins = instruction(line);
			if (!ins || ins.op === "alias" || ins.op === "define") continue;
			const writes = !NO_RESULT.has(ins.op) && !ins.op.startsWith("b") && ins.args.length > 0;
			ins.args.forEach((arg, i) => {
				const reg = register(arg);
				if (!reg) return;
				if (writes && i === 0 && !/^rr/.test(arg)) {
					if (!written.has(reg)) written.set(reg, line.index);
					return;
				}
				if (!written.has(reg) && !read.has(reg)) {
					context.report({
						line: line.index,
						column: line.columns[i + 1]!,
						message: `${arg === reg ? reg : `${arg} (${reg})`} is read before anything writes it, so it's 0 (or whatever it held before a restart)`,
					});
				}
				read.add(reg);
			});
		}
		for (const [reg, line] of written) {
			if (!read.has(reg)) context.report({ line, message: `${reg} is written but never read` });
		}
	},
};
