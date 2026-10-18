/**
 * `ic10-link watch`: a pass at the start, then another whenever a script, a station's map, a test
 * or a chip's file changes. The watchers below only report changes; `Scheduler` decides when a
 * pass runs.
 */
import { type FSWatcher, watch as watchFolder } from "node:fs";
import { newSession, type Session, type SyncOptions, syncOnce } from "../sync/sync.ts";
import { Scheduler } from "./scheduler.ts";

/** Folders in the project whose changes don't matter (tools' own output). */
const IGNORED = /^(node_modules|\.git|\.ic10-link|\.ic10-bench|coverage|reports)([\\/]|$)/;

export interface WatchOptions extends SyncOptions {
	/** Stops watching. */
	signal?: AbortSignal;
}

/** What changed in the project: a script or a station's map, or code (a test, or a helper of one). */
export type ProjectChange = "script" | "code";

/** Watches the project for changes to its scripts, maps and tests. */
export function watchProject(root: string, onChange: (change: ProjectChange) => void): FSWatcher {
	return watchFolder(root, { recursive: true }, (_event, name) => {
		if (!name || IGNORED.test(name)) return;
		if (/\.(ts|js|mjs|cjs)$/i.test(name)) onChange("code");
		else if (/\.(ic10|json)$/i.test(name)) onChange("script");
	});
}

/** Watches a station's chip files, which the IC10Sync mod writes. */
export function watchStation(dir: string, onChange: () => void): FSWatcher {
	return watchFolder(dir, onChange);
}

/** A test may have changed: forget the checks done, and that a script was held back, so both happen again. */
function forgetChecks(session: Session): void {
	session.gates.clear();
	for (const [id, said] of session.said) if (said.startsWith("blocked:")) session.said.delete(id);
}

/** Resolves when `signal` aborts (never, without one). */
function aborted(signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		signal?.addEventListener("abort", () => resolve(), { once: true });
	});
}

/** Watches until `signal` aborts. */
export async function watch(options: WatchOptions): Promise<void> {
	const session = options.session ?? newSession();
	const { log } = options;

	const passes = new Scheduler(async () => {
		try {
			await syncOnce({ ...options, session });
		} catch (error) {
			log(`error: ${(error as Error).message}`);
		}
	});

	const watchers = [
		watchProject(options.root, (change) => {
			if (change === "code") forgetChecks(session);
			passes.changed();
		}),
		watchStation(options.station.dir, () => passes.changed()),
	];

	log(`Watching ${options.root} and ${options.station.dir}. Ctrl+C stops.`);
	passes.run();
	await aborted(options.signal);
	for (const watcher of watchers) watcher.close();
	await passes.stop();
}
