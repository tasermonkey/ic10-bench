import type { Rule } from "../types.ts";
import { batchOps } from "./batch-ops.ts";
import { hashName } from "./hash-name.ts";
import { absoluteJumpNumber, relativeBranchToLabel } from "./jumps.ts";
import { maxBytes } from "./max-bytes.ts";
import { maxColumns } from "./max-columns.ts";
import { maxLines } from "./max-lines.ts";
import { registerFlow } from "./register-flow.ts";
import { unused } from "./unused.ts";
import { validate } from "./validate.ts";

/** Every rule, in the order their findings are listed. */
export const RULES: readonly Rule[] = [
	maxLines,
	maxColumns,
	maxBytes,
	validate,
	batchOps,
	hashName,
	relativeBranchToLabel,
	absoluteJumpNumber,
	unused,
	registerFlow,
];
