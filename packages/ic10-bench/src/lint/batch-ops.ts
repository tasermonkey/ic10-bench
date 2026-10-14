/**
 * The batch-instruction check moved to @tasermonkey/ic10-lint (its `batch-ops` rule). It's
 * re-exported here so existing imports keep working; pass it `loadCatalog()` for the project's
 * devices, mods included.
 */
export { type BatchOpCatalog, type BatchOpFinding, type BatchOpProblem, checkBatchOps } from "@tasermonkey/ic10-lint";
