import { checkBatchOps } from "../batch-ops.ts";
import type { Rule } from "../types.ts";

export const batchOps: Rule = {
	id: "batch-ops",
	defaultSeverity: "error",
	needsCatalog: true,
	description: "Batch instructions (lb, sbn, …) use logic types their prefab has, with the right Read/Write",
	check(context) {
		if (!context.catalog) return;
		for (const finding of checkBatchOps(context.script, context.catalog)) {
			context.report({ line: finding.line, column: finding.column, message: finding.message });
		}
	},
};
