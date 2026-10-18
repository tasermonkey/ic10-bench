/**
 * When to run a task that changes call for, like `watch`'s passes: once changes have settled for a
 * moment, never two at once, and once more after a run if something changed during it. Whatever
 * reports the changes needn't know any of that; it calls `changed()`.
 */

/** How long to wait after a change for more, before running. */
export const SETTLE_MS = 300;

export class Scheduler {
	readonly #task: () => Promise<void>;
	readonly #settleMs: number;
	/** The run in progress. */
	#running: Promise<void> | undefined;
	/** Something asked for a run during the one in progress. */
	#again = false;
	/** The wait for changes to settle. */
	#timer: NodeJS.Timeout | undefined;
	#stopped = false;

	constructor(task: () => Promise<void>, settleMs = SETTLE_MS) {
		this.#task = task;
		this.#settleMs = settleMs;
	}

	/** Something changed: run once nothing more has changed for `settleMs`. */
	changed(): void {
		if (this.#stopped) return;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.run(), this.#settleMs);
	}

	/** Run now, or straight after the run in progress. */
	run(): void {
		if (this.#stopped) return;
		if (this.#running) {
			this.#again = true;
			return;
		}
		this.#running = this.#task().finally(() => {
			this.#running = undefined;
			if (this.#again) {
				this.#again = false;
				this.run();
			}
		});
	}

	/** No more runs; resolves once the one in progress (if any) has finished. */
	async stop(): Promise<void> {
		this.#stopped = true;
		this.#again = false;
		clearTimeout(this.#timer);
		await this.#running;
	}
}
