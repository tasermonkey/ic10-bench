import type { Rule } from "../types.ts";

/** An alias, define or label that nothing refers to: dead weight in a script with little room. */
export const unused: Rule = {
	id: "unused",
	defaultSeverity: "warning",
	description: "An alias, define or label that's never used",
	check(context) {
		const { lines, aliases, defines, labels } = context.script;
		// Every token that isn't the name being declared.
		const used = new Set<string>();
		for (const line of lines) {
			if (line.label) continue;
			const declares = line.tokens[0] === "alias" || line.tokens[0] === "define";
			line.tokens.forEach((token, i) => {
				if (declares && i === 1) return;
				used.add(token);
				const pinned = /^([A-Za-z_]\w*):\d+$/.exec(token); // a device alias with a port, `Pump:1`
				if (pinned) used.add(pinned[1]!);
			});
		}
		const reported = new Set<string>();
		for (const [kind, list] of [["alias", aliases], ["define", defines], ["label", labels]] as const) {
			for (const { name, line } of list) {
				if (used.has(name) || reported.has(name)) continue;
				reported.add(name);
				const column = lines[line]!.text.indexOf(name);
				context.report({ line, column: Math.max(0, column), message: `${kind} ${name} is never used` });
			}
		}
	},
};
