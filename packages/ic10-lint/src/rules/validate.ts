import { ErrorSeverity, JUMP_LIMIT_ERROR_CODE, ValidateIc10Runner } from "@tasermonkey/ic10";
import type { Rule } from "../types.ts";

/**
 * The emulator's own check of the script, with no devices: syntax, argument counts, unknown
 * aliases, defines and labels. Only its strong and critical errors count. The jump limit is
 * ignored: the check runs the script with no devices, and a script that loops forever is normal.
 */
export const validate: Rule = {
	id: "validate",
	defaultSeverity: "error",
	description: "Loads in the emulator: syntax, argument counts, unknown aliases, defines and labels",
	async check(context) {
		const { lines } = context.script;
		const code = lines.map((line) => line.text).join("\n");
		const errors = await ValidateIc10Runner.validate(code, { jumpLimit: 100_000 });
		const seen = new Set<string>();
		for (const error of errors) {
			if (error.severity !== ErrorSeverity.Strong && error.severity !== ErrorSeverity.Critical) continue;
			if (error.code === JUMP_LIMIT_ERROR_CODE) continue;
			const line = Math.max(0, Math.min(error.line ?? 0, lines.length - 1));
			const key = `${line}:${error.message}`;
			if (seen.has(key)) continue; // the sandbox pass can visit a line more than once
			seen.add(key);
			context.report({ line, column: error.start ?? 0, message: error.message });
		}
	},
};
