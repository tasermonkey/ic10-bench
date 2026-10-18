export { type CliIo, runCli } from "./cli.ts";

// The game's side: the IC10Sync mod's folder.
export {
	CHIPDATA_ENV,
	CHIPDATA_IN_DOCUMENTS,
	type Chip,
	type FindOptions,
	findChipdata,
	findStation,
	listChips,
	listStations,
	parseChipFile,
	type Station,
} from "./game/chipdata.ts";
export { documentsFolder, expandWindowsVariables, windowsDocuments } from "./game/os.ts";

// The project's side: its station maps.
export { adoptChip, chipId, type MapResult, mapChip, unmapChip } from "./project/mapping.ts";
export { type ChipEntry, loadStation, STATIONS_DIR, type StationMap, saveStation, scriptPath, stationFile } from "./project/stations.ts";

// Comparing and copying between the two.
export { checkScript, type GateOptions, type GateResult, projectTests, projectVitest, type TestRun } from "./sync/gate.ts";
export { loadState, saveState, STATE_DIR, type SyncState, stateFile, textHash } from "./sync/state.ts";
export {
	type ChipFile,
	type Duplicate,
	type MappedChip,
	type MappedState,
	type StationStatus,
	stationStatus,
	type UnmappedChip,
} from "./sync/status.ts";
export { newSession, type Outcome, type OutcomeKind, PRESERVED_DIR, type Session, type SyncOptions, syncOnce } from "./sync/sync.ts";
export { gameText } from "./sync/text.ts";

// Watching for changes.
export { SETTLE_MS, Scheduler } from "./watch/scheduler.ts";
export { type ProjectChange, type WatchOptions, watch, watchProject, watchStation } from "./watch/watch.ts";
