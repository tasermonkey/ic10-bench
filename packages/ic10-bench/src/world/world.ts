import { LogicMirror } from "../engine/mirror.ts";
import type { EnvSchema } from "@tasermonkey/ic10";
import { SimBudgetError, SimRunError } from "../scheduler/errors.ts";
import type { ChipState, Scheduler } from "../scheduler/scheduler.ts";
import { secondsToTicks } from "../scheduler/time.ts";
import type { Cancel, EventOptions, EventQueue, Interval, ScheduledEvent, When, WorldEvent } from "./events.ts";
import { type DeviceModel, ModelList, type WorldModel } from "./models.ts";
import type { EnvWorldOptions } from "./from-env.ts";
import { type Change, diffSnapshots, Recording, type Snapshot } from "./snapshot.ts";
import type { Mixture, Reservoir } from "../atmos/mixture.ts";
import { GASES, type GasName, isGasName } from "../atmos/gases.ts";
import type { AtmosphereEntry } from "./atmospheres.ts";
import { ChipHandle } from "./handles/chip.ts";
import { type DeviceEntry, DeviceHandle, MirrorHandle } from "./handles/device.ts";
import { NetworkHandle } from "./handles/network.ts";

// The handles live in handles/; they're exported from here too, where they always were.
export { ChipHandle, type DeviceEntry, DeviceHandle, MirrorHandle, NetworkHandle };
export { SlotHandle } from "./handles/device.ts";

/** Settings a built world runs with (see `SimOptions` for what each means). */
export interface WorldOptions {
	tickSeconds: number;
	maxTicks: number;
	maxLinesPerRun: number;
}

/** Budget for a run call that has no fixed length. */
export interface RunBudget {
	/** Fail if the call runs this many ticks without finishing. Defaults to the world's `maxTicks`. */
	maxTicks?: number;
}

/**
 * A built world: devices on data networks, and chips run under the game's tick rules. Build one
 * with `sim()`.
 */
export class World {
	private readonly devices = new Map<string, DeviceHandle>();
	private readonly chips = new Map<string, ChipHandle>();
	private readonly recordings: Recording[] = [];
	private running = false;
	/** @internal Set by the builder once the scheduler exists. */
	scheduler!: Scheduler;

	private readonly events: EventQueue;
	readonly options: WorldOptions;

	/**
	 * Build a world from emulator env JSON: an object, JSON text, or a path to a `.json` file.
	 * Devices are keyed by their `name` when it's unique, otherwise by reference ID in `$hex` form.
	 */
	static async fromEnv(env: EnvSchema | string, options?: EnvWorldOptions): Promise<World> {
		// Loaded here: from-env.ts builds a World through sim.ts, which imports this file.
		const { worldFromEnv } = await import("./from-env.ts");
		return worldFromEnv(env, options);
	}

	private readonly atmospheres = new Map<string, AtmosphereEntry>();
	private readonly models = new ModelList();

	constructor(devices: DeviceEntry[], events: EventQueue, atmospheres: AtmosphereEntry[], options: WorldOptions) {
		this.events = events;
		this.options = options;
		for (const entry of devices) {
			const handle = entry.device instanceof LogicMirror ? new MirrorHandle(this, entry) : new DeviceHandle(this, entry);
			this.devices.set(entry.key, handle);
		}
		for (const entry of atmospheres) this.atmospheres.set(entry.key, entry);
	}

	/** @internal */
	attach(scheduler: Scheduler): void {
		this.scheduler = scheduler;
		for (const state of scheduler.chips) this.chips.set(state.key, new ChipHandle(this, state));
	}

	/**
	 * @internal Scheduler hook: start of a tick. Scripted events run, then models, then devices
	 * update their readings from their pipes and rooms, so chips see this tick's atmosphere.
	 */
	async beginTick(tick: number): Promise<void> {
		const gate = this.scheduler.gate;
		await this.events.fire(tick, this, gate?.onEvent && ((label) => gate.onEvent!({ world: this, tick, label })));
		this.models.run(this.options.tickSeconds, this, tick);
		this.refreshReadings();
	}

	/**
	 * Update every attached device's readings from its pipes and rooms now. The world does this at
	 * the start of every tick; call it to see a change to a pipe on a device before the next tick.
	 */
	refreshReadings(): void {
		for (const device of this.devices.values()) device.refreshReadings();
	}

	/** @internal Scheduler hook: end of a tick. */
	async endTick(tick: number): Promise<void> {
		for (const recording of this.recordings) recording.sample(tick);
	}

	// --- accessors -------------------------------------------------------------------------------

	/** Ticks completed. */
	get tick(): number {
		return this.scheduler.tick;
	}

	/** Game time, in seconds, at the start of the tick in progress (or the next one). */
	get time(): number {
		return this.scheduler.time;
	}

	device(key: string): DeviceHandle {
		const handle = this.devices.get(key);
		if (!handle) throw new Error(`no device "${key}" (devices: ${[...this.devices.keys()].join(", ")})`);
		return handle;
	}

	/** A Logic Mirror, by key. */
	mirror(key: string): MirrorHandle {
		const handle = this.device(key);
		if (!(handle instanceof MirrorHandle)) throw new Error(`"${key}" is a ${handle.prefab}, not a Logic Mirror`);
		return handle;
	}

	chip(key: string): ChipHandle {
		const handle = this.chips.get(key);
		if (!handle) throw new Error(`no chip "${key}" (chips: ${[...this.chips.keys()].join(", ")})`);
		return handle;
	}

	/** Every device, housings included, in declaration order. */
	listDevices(): DeviceHandle[] {
		return [...this.devices.values()];
	}

	/** Every chip, in the order they run. */
	listChips(): ChipHandle[] {
		return [...this.chips.values()];
	}

	/** The device with this reference ID, or undefined. */
	deviceById(id: number): DeviceHandle | undefined {
		return this.listDevices().find((d) => d.id === id);
	}

	/** A pipe network, by key. */
	pipe(key: string): Mixture {
		return this.atmosphereEntry(key, "pipe").atmosphere as Mixture;
	}

	/** A room, by key: a `Mixture` for a sealed room, a `Reservoir` for outside air. */
	room(key: string): Mixture | Reservoir {
		return this.atmosphereEntry(key, "room").atmosphere;
	}

	/** A pipe or room, by key. */
	atmosphere(key: string): Mixture | Reservoir {
		const entry = this.atmospheres.get(key);
		if (!entry) throw new Error(`no pipe or room "${key}" (pipes and rooms: ${[...this.atmospheres.keys()].join(", ") || "none"})`);
		return entry.atmosphere;
	}

	/** Report lines for the pipes and rooms: `pipes and rooms:` then one line each. None if there are none. */
	describeAtmospheres(): string[] {
		if (this.atmospheres.size === 0) return [];
		const width = Math.max(...[...this.atmospheres.keys()].map((k) => k.length), 4);
		const lines = [...this.atmospheres.values()].map((entry) => {
			const values = atmosphereValues(entry);
			const gases = Object.entries(values)
				.filter(([name]) => name.startsWith("Ratio"))
				.map(([name, ratio]) => `${name.slice(5)} ${(ratio * 100).toFixed(1)}%`);
			const moles = values.TotalMoles === undefined ? "" : ` ${round(values.TotalMoles)} mol,`;
			const kind = entry.atmosphere.volume === Infinity ? "outside" : `${entry.kind} ${round(entry.atmosphere.volume)} L`;
			return `  ${entry.key.padEnd(width)}  ${kind}: ${round(values.Pressure!)} kPa, ${round(values.Temperature!)} K,${moles} ${gases.join(", ") || "empty"}`;
		});
		return ["pipes and rooms:", ...lines];
	}

	/** Every pipe and room, in declaration order. */
	listAtmospheres(): readonly AtmosphereEntry[] {
		return [...this.atmospheres.values()];
	}

	/** The device hosting a chip, i.e. its `db`: its housing, or a device kind's device. */
	db(key: string): DeviceHandle {
		return this.chip(key).db;
	}

	network(id: string): NetworkHandle {
		const handles = [...this.devices.values()].filter((d) => d.network === id);
		if (handles.length === 0) throw new Error(`no devices on network "${id}"`);
		return new NetworkHandle(handles);
	}

	/**
	 * A value by path: `vent.On` (a device property), `ic.Stage` or `ic.r15` (a chip register or
	 * alias; anything else on a chip key is its housing's property, e.g. `ic.Setting`), or
	 * `coolant.Temperature` (a pipe or room: `Pressure`, `Temperature`, `TotalMoles`, `Volume`,
	 * `Ratio<Gas>`, or a gas's moles by name, e.g. `coolant.Nitrogen`).
	 */
	value(path: string): number {
		const { key, name } = splitPath(path);
		const atmosphere = this.atmospheres.get(key);
		if (atmosphere) return atmosphereValue(atmosphere, name);
		const chip = this.chips.get(key);
		if (chip?.hasRegister(name)) return chip.reg(name);
		return chip ? chip.db.get(name) : this.device(key).get(name);
	}

	/** A path as snapshots spell it: a register alias becomes its register (`ic.Stage` → `ic.r15`). */
	canonicalPath(path: string): string {
		const { key, name } = splitPath(path);
		const chip = this.chips.get(key);
		if (chip?.hasRegister(name)) return `${key}.r${chip.registerIndex(name)}`;
		return path;
	}

	// --- running ---------------------------------------------------------------------------------

	/**
	 * Execute `n` lines of one chip, ignoring ticks: `yield` and `sleep` don't stop it and no game
	 * time passes. Stops early if the chip halts or ends. The chip may be left out when there's only one.
	 */
	step(n = 1, chip?: string): Promise<void> {
		return this.guard(async () => {
			const state = this.pickChip(chip, "step");
			for (let i = 0; i < n && !state.stopped; i++) await this.scheduler.stepChip(state, false);
		});
	}

	/** Run `n` ticks of game time. */
	runTicks(n: number): Promise<void> {
		return this.guard(async () => {
			if (!(Number.isInteger(n) && n >= 0)) throw new Error(`runTicks: invalid number of ticks: ${n}`);
			const target = this.scheduler.tick + n;
			while (this.scheduler.tick < target) await this.scheduler.advance();
		});
	}

	/** Run `seconds` of game time (rounded up to whole ticks). */
	runSeconds(seconds: number): Promise<void> {
		return this.runTicks(secondsToTicks(seconds, this.options.tickSeconds));
	}

	/**
	 * Run whole ticks until `condition` holds. It's checked before starting and after every tick.
	 * Fails with a trace if `maxTicks` pass first, or if nothing can change any more.
	 */
	runUntil(condition: (world: World) => boolean | Promise<boolean>, budget?: RunBudget): Promise<void> {
		return this.guard(async () => {
			const maxTicks = budget?.maxTicks ?? this.options.maxTicks;
			if (await condition(this)) return;
			let ticks = 0;
			for (;;) {
				if ((await this.scheduler.advance()) !== "tick") continue;
				if (await condition(this)) return;
				if (++ticks >= maxTicks) {
					throw new SimBudgetError(`runUntil: the condition was still false after ${maxTicks} ticks (maxTicks)`, this.scheduler);
				}
				if (this.idle()) {
					throw new SimRunError(
						"runUntil: the condition is false and can't change: every chip has stopped and no events are due",
						this.scheduler,
					);
				}
			}
		});
	}

	/**
	 * Run until a chip is about to execute a line (an index, or a label), and stop there, possibly in
	 * the middle of a tick. If the chip is already there, it runs until it comes back.
	 */
	runUntilLine(target: number | string, options?: RunBudget & { chip?: string }): Promise<void> {
		return this.guard(async () => {
			const state = this.pickChip(options?.chip, "runUntilLine");
			const line = this.resolveLine(state, target);
			const maxTicks = options?.maxTicks ?? this.options.maxTicks;
			const start = state.linesExecuted;
			let ticks = 0;
			for (;;) {
				if (state.stopped) {
					throw new SimRunError(`runUntilLine: "${state.key}" stopped before reaching line ${line}`, this.scheduler);
				}
				const result = await this.scheduler.advance(
					(chip, next) => chip === state && next === line && state.linesExecuted > start,
				);
				if (result === "stopped") return;
				if (result === "tick" && ++ticks >= maxTicks) {
					throw new SimBudgetError(
						`runUntilLine: "${state.key}" didn't reach line ${line} within ${maxTicks} ticks (maxTicks)`,
						this.scheduler,
					);
				}
			}
		});
	}

	/** Run whole ticks until every chip has halted or ended. For one-shot scripts. */
	runToHalt(budget?: RunBudget): Promise<void> {
		return this.runWhile(
			() => this.scheduler.chips.some((c) => !c.stopped),
			"runToHalt",
			"some chips were still running",
			budget,
		);
	}

	/** @internal Run whole ticks while `running()` holds. */
	runWhile(running: () => boolean, name: string, stillRunning: string, budget?: RunBudget): Promise<void> {
		return this.guard(async () => {
			const maxTicks = budget?.maxTicks ?? this.options.maxTicks;
			let ticks = 0;
			while (running()) {
				if ((await this.scheduler.advance()) === "tick" && ++ticks >= maxTicks && running()) {
					throw new SimBudgetError(`${name}: ${stillRunning} after ${maxTicks} ticks (maxTicks)`, this.scheduler);
				}
			}
			while (this.scheduler.tickInProgress) await this.scheduler.advance();
		});
	}

	// --- scripted events -------------------------------------------------------------------------

	/** Run `event` once, at the start of a tick (before any chip runs in it). */
	at(when: When, event: WorldEvent, options?: EventOptions): Cancel {
		const tick = "tick" in when ? when.tick : secondsToTicks(when.seconds, this.options.tickSeconds);
		if (tick < this.nextTickToStart()) throw new Error(`at: tick ${tick} has already started (world is at tick ${this.tick})`);
		return this.events.at(tick, event, options);
	}

	/** Run `event` every interval, starting one interval from now (or at `start`). */
	every(interval: Interval, event: WorldEvent, options?: EventOptions & { start?: When }): Cancel {
		const ticks = "ticks" in interval ? interval.ticks : secondsToTicks(interval.seconds, this.options.tickSeconds);
		const start = options?.start;
		const first =
			start === undefined
				? this.nextTickToStart() + ticks
				: "tick" in start
					? start.tick
					: secondsToTicks(start.seconds, this.options.tickSeconds);
		return this.events.every(ticks, first, event, options);
	}

	/** Run `event` whenever `condition` becomes true (checked at the start of each tick). */
	when(condition: (world: World) => boolean | Promise<boolean>, event: WorldEvent, options?: EventOptions): Cancel {
		return this.events.when(condition, event, options);
	}

	/** Scripted events still to come, in the order they were added (every `when`, since it may yet fire). */
	listEvents(): ScheduledEvent[] {
		return this.events.list(this.nextTickToStart());
	}

	// --- models ----------------------------------------------------------------------------------

	/**
	 * Give a device behaviour: `run(device, dt, world)` runs at the start of every tick, after
	 * scripted events and before chips, so what a script sets in one tick acts in the next.
	 */
	model(device: string, run: DeviceModel): Cancel;
	/** Add world behaviour that isn't one device's: `run(dt, world)` every tick, as above. */
	model(run: WorldModel): Cancel;
	model(target: string | WorldModel, run?: DeviceModel): Cancel {
		if (typeof target === "function") return this.models.add("world", target);
		const handle = this.device(target);
		if (!run) throw new Error(`model: no model given for "${target}"`);
		return this.models.add(`"${target}"`, (dt, world) => run(handle, dt, world));
	}

	/** What each model is for, in the order they run: a device's key, or "world" for a world model. */
	listModels(): string[] {
		return this.models.labels().map((label) => label.replace(/^"(.*)"$/, "$1"));
	}

	// --- snapshots and history -------------------------------------------------------------------

	/** Every device property and chip register now. */
	snapshot(): Snapshot {
		const values: Record<string, number> = {};
		for (const [key, device] of this.devices) {
			for (const [prop, value] of Object.entries(device.props())) values[`${key}.${prop}`] = value;
		}
		for (const [key, chip] of this.chips) {
			for (const [reg, value] of Object.entries(chip.registers())) values[`${key}.${reg}`] = value;
		}
		for (const [key, entry] of this.atmospheres) {
			for (const [name, value] of Object.entries(atmosphereValues(entry))) values[`${key}.${name}`] = value;
		}
		return { tick: this.tick, values };
	}

	/** What changed since `before` (or between two snapshots). */
	diff(before: Snapshot, after: Snapshot = this.snapshot()): Change[] {
		return diffSnapshots(before, after);
	}

	/** Record a value now and at the end of every tick from here on: a path (see `value`) or a function. */
	record(what: string | ((world: World) => number)): Recording {
		const recording =
			typeof what === "string"
				? new Recording(what, () => this.value(what))
				: new Recording("<fn>", () => what(this));
		recording.sample(this.tick);
		this.recordings.push(recording);
		return recording;
	}

	// --- helpers ---------------------------------------------------------------------------------

	private atmosphereEntry(key: string, kind: AtmosphereEntry["kind"]): AtmosphereEntry {
		const entry = this.atmospheres.get(key);
		if (entry?.kind === kind) return entry;
		const all = [...this.atmospheres.values()].filter((a) => a.kind === kind).map((a) => a.key);
		const other = entry ? ` ("${key}" is a ${entry.kind})` : "";
		throw new Error(`no ${kind} "${key}"${other} (${kind}s: ${all.join(", ") || "none"})`);
	}

	private nextTickToStart(): number {
		return this.scheduler.tickInProgress ? this.scheduler.tick + 1 : this.scheduler.tick;
	}

	/** Nothing can change any more: every chip has stopped, no events are due and there are no models. */
	idle(): boolean {
		return (
			this.scheduler.chips.every((c) => c.stopped) && !this.events.pending(this.scheduler.tick) && this.models.size === 0
		);
	}

	private pickChip(key: string | undefined, call: string): ChipState {
		const chips = this.scheduler.chips;
		if (key === undefined) {
			if (chips.length === 1) return chips[0]!;
			throw new Error(`${call}: the world has ${chips.length} chips; say which one`);
		}
		const state = chips.find((c) => c.key === key);
		if (!state) throw new Error(`${call}: no chip "${key}"`);
		return state;
	}

	private resolveLine(state: ChipState, target: number | string): number {
		if (typeof target === "number") {
			if (Number.isInteger(target) && target >= 0 && target < state.engine.lineCount) return target;
			throw new Error(`"${state.key}" has no line ${target} (it has ${state.engine.lineCount})`);
		}
		const line = state.engine.findLabel(target);
		if (line === undefined) throw new Error(`"${state.key}" has no label "${target}"`);
		return line;
	}

	/** One run call at a time, each with its own line budget. */
	private async guard(run: () => Promise<void>): Promise<void> {
		if (this.running) throw new Error("a run is already in progress (missing await?)");
		this.running = true;
		this.scheduler.linesThisRun = 0;
		try {
			await run();
		} finally {
			this.running = false;
		}
	}
}

/**
 * A pipe's or room's values as snapshots and reports show them: pressure, temperature, moles (not
 * for outside air, which has no end) and the ratio of each gas present.
 */
export function atmosphereValues(entry: AtmosphereEntry): Record<string, number> {
	const atmos = entry.atmosphere;
	const out: Record<string, number> = { Pressure: atmos.pressure, Temperature: atmos.temperature };
	if (Number.isFinite(atmos.totalMoles)) out.TotalMoles = atmos.totalMoles;
	for (const gas of GASES) {
		const ratio = atmos.ratio(gas.name);
		if (ratio > 0) out[`Ratio${gas.name}`] = ratio;
	}
	return out;
}

/** A number to 4 significant figures, for reports. */
function round(value: number): string {
	return Number.isFinite(value) ? String(Number(value.toPrecision(4))) : String(value);
}

function atmosphereValue(entry: AtmosphereEntry, name: string): number {
	const atmos = entry.atmosphere;
	switch (name) {
		case "Pressure":
			return atmos.pressure;
		case "Temperature":
			return atmos.temperature;
		case "TotalMoles":
			return atmos.totalMoles;
		case "Volume":
			return atmos.volume;
	}
	if (name.startsWith("Ratio") && isGasName(name.slice(5))) return atmos.ratio(name.slice(5) as GasName);
	if (isGasName(name)) return atmos.moles(name);
	throw new Error(
		`${entry.kind} "${entry.key}" has no value "${name}" (use Pressure, Temperature, TotalMoles, Volume, Ratio<Gas>, or a gas's name for its moles)`,
	);
}

function splitPath(path: string): { key: string; name: string } {
	const dot = path.lastIndexOf(".");
	if (dot <= 0) throw new Error(`invalid path "${path}": use "<key>.<property or register>"`);
	return { key: path.slice(0, dot), name: path.slice(dot + 1) };
}
