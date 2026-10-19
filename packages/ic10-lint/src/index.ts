export { type BatchOpFinding, type BatchOpProblem, checkBatchOps } from "./batch-ops.ts";
export { type CliIo, fileLink, PROJECT_CATALOG, projectCatalog, readCatalog, runCli, wantsColor } from "./cli.ts";
export { runProgram } from "./program.ts";
export {
	CONFIG_FILE,
	type FileOverride,
	isPattern,
	type LintConfig,
	loadConfig,
	overrideFor,
	overrideMatches,
	projectRelative,
} from "./config.ts";
export { type FileReport, findScripts, lintFile, lintFiles, lintProject } from "./files.ts";
export { type InitOptions, initConfig, type RecommendedConfig, recommendedConfig } from "./init.ts";
export { GAME_LIMITS, gameSize, type LimitName, type LimitOverride } from "./limits.ts";
export { atLeast, type LintOptions, lint, normalizeSeverity } from "./lint.ts";
export { parseLiteral } from "./numbers.ts";
export {
	anchorCode,
	type BlockAnchors,
	locateBlocks,
	markedDefines,
	PER_CHIP_MARKER,
	type PerChipBlock,
	type PerChipFile,
	type PerChipProblem,
	perChipBlocks,
	perChipFile,
	readPerChipFile,
} from "./per-chip.ts";
export { RULES } from "./rules/index.ts";
export { parseScript, type Script, type SourceLine } from "./source.ts";
export type { BatchOpCatalog, Finding, LintPrefab, Rule, RuleContext, Severity, SeveritySetting } from "./types.ts";
