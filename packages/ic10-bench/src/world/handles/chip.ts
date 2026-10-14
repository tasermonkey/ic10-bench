import type { Ic10Error } from "@tasermonkey/ic10";
import type { ScriptDefine } from "../../engine/chip.ts";
import { describeChip } from "../../scheduler/errors.ts";
import type { AutoYield, ChipState, Halt, TraceEntry } from "../../scheduler/scheduler.ts";
import type { RunBudget, World } from "../world.ts";
import type { DeviceHandle } from "./device.ts";

/** A chip in its housing, found by the housing's test-side key. */
export class ChipHandle {
	/** The world the chip is in. */
	readonly world: World;
	private readonly state: ChipState;

	constructor(world: World, state: ChipState) {
		this.world = world;
		this.state = state;
	}

	get key(): string {
		return this.state.key;
	}

	/** Where the program came from: a file path as the test gave it, `<code>`, or `<env>`. */
	get source(): string {
		return this.state.source;
	}

	/** Absolute path of the program's file, or undefined for inline (`code:`) and env programs. */
	get path(): string | undefined {
		return this.state.path;
	}

	/** Which device (by key) is on each pin, e.g. `{ d0: "vent" }`. */
	get pins(): Readonly<Record<string, string>> {
		return this.state.pins;
	}

	/** The housing, i.e. the chip's `db`. */
	get db(): DeviceHandle {
		return this.world.device(this.state.key);
	}

	/** A register's value, by `r0`–`r17`, `sp`, `ra`, or an alias the script has defined. */
	reg(name: string): number {
		return this.state.engine.register(this.registerIndex(name));
	}

	/** Set a register, by name or alias. */
	setReg(name: string, value: number): this {
		this.state.engine.setRegister(this.registerIndex(name), value);
		return this;
	}

	/** Whether `name` is a register, or an alias the script has defined so far. */
	hasRegister(name: string): boolean {
		return this.state.engine.resolveRegister(name) !== undefined;
	}

	/** Every register by raw name (`r0`…). */
	registers(): Record<string, number> {
		const out: Record<string, number> = {};
		for (let i = 0; i < this.state.engine.registerCount; i++) out[`r${i}`] = this.state.engine.register(i);
		return out;
	}

	/** Aliases defined so far, by register name, e.g. `{ r15: ["Stage"] }`. */
	aliases(): Record<string, string[]> {
		const out: Record<string, string[]> = {};
		for (const [index, names] of this.state.engine.aliases()) out[`r${index}`] = names;
		return out;
	}

	get sp(): number {
		return this.state.engine.register(this.state.engine.stackPointerRegister);
	}

	get ra(): number {
		return this.state.engine.register(this.state.engine.returnAddressRegister);
	}

	/** The stack below `sp` (what has been pushed). */
	stack(): number[] {
		const size = Math.max(0, Math.floor(this.sp));
		return Array.from({ length: size }, (_, i) => this.state.engine.stackAt(i));
	}

	/** One stack entry, whatever `sp` is (what `get` / `put` address). */
	stackAt(index: number): number {
		return this.state.engine.stackAt(index);
	}

	/** How many entries the stack has (the game's chips have 512). */
	get stackLength(): number {
		return this.state.engine.stackLength;
	}

	/** Set one stack entry, whatever `sp` is. */
	setStackAt(index: number, value: number): this {
		this.state.engine.setStackAt(index, value);
		return this;
	}

	/** What the script has defined so far (defines, aliases and labels), built-in constants left out. */
	defines(): ScriptDefine[] {
		return this.state.engine.defines();
	}

	/** The line the chip runs next, or the line it halted on (0-based, like the game's `LineNumber`). */
	get line(): number {
		return this.state.halt?.line ?? this.state.engine.nextLine;
	}

	/** Source text of a line (default: `line`). */
	lineText(index: number = this.line): string | undefined {
		return this.state.engine.lineText(index);
	}

	/** Whether a line is an instruction, as opposed to a blank, comment or label line. */
	isInstruction(index: number): boolean {
		return this.state.engine.isInstruction(index);
	}

	/** Line index of a label, or undefined if the program has no such label. */
	findLabel(name: string): number | undefined {
		return this.state.engine.findLabel(name);
	}

	/** Number of source lines. */
	get lineCount(): number {
		return this.state.engine.lineCount;
	}

	/** Every error recorded on the chip, of any severity. */
	get errors(): Ic10Error[] {
		return this.state.engine.errors;
	}

	/** Why and where the chip halted, or null if it hasn't. */
	get halt(): Halt | null {
		return this.state.halt;
	}

	get halted(): boolean {
		return this.state.halt !== null;
	}

	/** Ran off the end of its program (without an error). */
	get ended(): boolean {
		return this.state.ended;
	}

	get sleeping(): boolean {
		return this.state.sleepUntil !== null;
	}

	/** Game time, in seconds, the chip sleeps until, or null if it isn't sleeping. */
	get sleepUntil(): number | null {
		return this.state.sleepUntil;
	}

	/** Lines it has used toward the tick in progress's limit (see `linesPerTick`). */
	get linesThisTick(): number {
		return this.state.linesThisTick;
	}

	/** Its housing was switched off (`On` = 0) when its turn last came, so it isn't running. */
	get switchedOff(): boolean {
		return this.state.switchedOff;
	}

	/** Ticks in which it restarted from line 0 because its housing was switched back on. */
	get restarts(): readonly number[] {
		return this.state.restartLog;
	}

	/** Times the chip used up its lines for a tick and was preempted. */
	get autoYields(): number {
		return this.state.autoYields;
	}

	/** Every automatic yield so far: the tick and the last line run before it. */
	get autoYieldLog(): readonly AutoYield[] {
		return this.state.autoYieldLog;
	}

	/** Lines executed in total. */
	get linesExecuted(): number {
		return this.state.linesExecuted;
	}

	/** Lines per tick before an automatic yield. */
	get linesPerTick(): number {
		return this.state.linesPerTick;
	}

	/** Where the chip is, in one line: halted, ended, sleeping or the line it runs next. */
	get status(): string {
		return describeChip(this.state, this.world.scheduler);
	}

	/** The last lines this chip ran (up to `n`, from what the world keeps; see `traceLength`). */
	recentLines(n = 20): TraceEntry[] {
		return this.world.scheduler.trace.filter((entry) => entry.chip === this.key).slice(-n);
	}

	/** Run whole ticks until this chip halts or ends. */
	runToHalt(budget?: RunBudget): Promise<void> {
		return this.world.runWhile(() => !this.state.stopped, "runToHalt", `"${this.key}" was still running`, budget);
	}

	/** @internal */
	registerIndex(name: string): number {
		const index = this.state.engine.resolveRegister(name);
		if (index === undefined) {
			const known = Object.values(this.aliases()).flat().join(", ");
			throw new Error(`"${this.key}" has no register or alias "${name}" (aliases so far: ${known || "none"})`);
		}
		return index;
	}
}
