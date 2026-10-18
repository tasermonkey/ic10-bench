import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler } from "../../src/watch/scheduler.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A task that counts its runs, and finishes only when `finish()` is called. */
function task() {
	let runs = 0;
	const finishers: (() => void)[] = [];
	return {
		run: () => {
			runs++;
			return new Promise<void>((resolve) => finishers.push(resolve));
		},
		runs: () => runs,
		finish: async () => {
			finishers.shift()?.();
			await vi.advanceTimersByTimeAsync(0);
		},
	};
}

describe("Scheduler", () => {
	it("runs once changes have settled, however many there were", async () => {
		const t = task();
		const scheduler = new Scheduler(t.run, 100);
		scheduler.changed();
		await vi.advanceTimersByTimeAsync(60);
		scheduler.changed();
		await vi.advanceTimersByTimeAsync(60);
		expect(t.runs()).toBe(0);
		await vi.advanceTimersByTimeAsync(40);
		expect(t.runs()).toBe(1);
	});

	it("never runs twice at once, and runs once more after a run that changes came in during", async () => {
		const t = task();
		const scheduler = new Scheduler(t.run, 100);
		scheduler.run();
		scheduler.run();
		scheduler.changed();
		await vi.advanceTimersByTimeAsync(100);
		scheduler.run();
		expect(t.runs()).toBe(1);

		await t.finish();
		expect(t.runs()).toBe(2);
		await t.finish();
		expect(t.runs()).toBe(2);
	});

	it("stops: no more runs, once the one in progress has finished", async () => {
		const t = task();
		const scheduler = new Scheduler(t.run, 100);
		scheduler.run();
		scheduler.changed();
		let stopped = false;
		const stopping = scheduler.stop().then(() => (stopped = true));
		await vi.advanceTimersByTimeAsync(100);
		expect(stopped).toBe(false);

		await t.finish();
		await stopping;
		scheduler.changed();
		scheduler.run();
		await vi.advanceTimersByTimeAsync(100);
		expect(t.runs()).toBe(1);
	});
});
