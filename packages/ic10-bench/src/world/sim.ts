import { resolve } from "node:path";
import type { PrefabProps } from "../prefabs.ts";
import { modPrefabs } from "../catalog/mods.ts";
import { type DebugGate, getDefaultDebugGate } from "../debug/gate.ts";
import { DEVICE_PIN } from "../debug/protocol.ts";
import { buildEngine, type Engine, type EngineDeviceSpec, type EngineHousingSpec } from "../engine/build.ts";
import { hash, hasDeviceData, isCatalogued } from "../engine/device.ts";
import { MIRROR_PREFAB } from "../engine/mirror.ts";
import { STUB_PREFAB } from "../engine/stub.ts";
import { parseId, type ReferenceId } from "../engine/ids.ts";
import { ChipState, Scheduler } from "../scheduler/scheduler.ts";
import { GAME_TICK_SECONDS } from "../scheduler/time.ts";
import { readScript } from "../scripts.ts";
import {
	type AtmosphereEntry,
	type AttachOptions,
	type Attachments,
	applyReadings,
	deviceReadings,
	makePipe,
	makeRoom,
	type PipeInit,
	type Port,
	type RoomInit,
} from "./atmospheres.ts";
import { EventQueue } from "./events.ts";
import type { DeviceKind, HostedChip, HostedProgram, KindContext } from "./kinds.ts";
import { type DeviceEntry, World } from "./world.ts";

/**
 * A prefab the device catalogue knows: the emulator's game data, or a mod's device in the project's
 * ic10-mods/ once `ic10-bench catalog` has written ic10-bench-env.d.ts (see prefabs.ts).
 */
export type KnownPrefab = keyof PrefabProps;

/** A known prefab's logic properties, read-only ones included (a test sets a sensor's readings). */
export type PropsOf<P extends KnownPrefab> = PrefabProps[P];

/** One device for `SimBuilder.devices()`: the arguments `device()` takes, with the props checked against the prefab. */
export type DeviceSpec = {
	[P in KnownPrefab]: readonly [key: string, prefab: P, props?: PropsOf<P>, options?: DeviceOptions & { custom?: false }];
}[KnownPrefab];

export interface SimOptions {
	/** Lines a chip runs per tick before an automatic yield. Default 128, as in game. */
	linesPerTick?: number;
	/**
	 * Whether blank, comment and label lines use up the per-tick budget. Default true: they do in game
	 * (confirmed 2026-10-07). With false, only instruction lines count.
	 */
	countNonInstructionLines?: boolean;
	/** Game time per tick, in seconds. Default 0.5. */
	tickSeconds?: number;
	/** Ticks a `runUntil` / `runUntilLine` / `runToHalt` may take before failing. Default 10,000. */
	maxTicks?: number;
	/** Lines (all chips together) one run call may execute before failing. Default 1,000,000. */
	maxLinesPerRun?: number;
	/** Throw as soon as any chip halts, instead of leaving it for the test to assert on. Default false. */
	failOnHalt?: boolean;
	/** Directory `file:` paths are relative to. Default: the working directory. */
	root?: string;
	/** Seed for `rand`, so runs repeat exactly. Default 1. */
	seed?: number;
	/** A debugger to consult as the world runs; false for none. Default: the gate set with `setDefaultDebugGate`. */
	debug?: DebugGate | false;
	/** Executed lines kept for failure reports. Default 50. */
	traceLength?: number;
	/**
	 * Whether a chip whose housing is switched off and on again also loses its registers and stack.
	 * Default false: it restarts from line 0 and keeps them (not yet confirmed in game).
	 */
	restartClearsState?: boolean;
}

/** Where a device is, what it's called in game, and the pipes and room it's attached to. */
export interface DeviceOptions extends AttachOptions {
	/** Reference ID: a number or the game's `$hex` form. Default: the next one in a fixed sequence. */
	id?: ReferenceId;
	/** In-game name, for `lbn` / `sbn`. Default: the prefab name. */
	name?: string;
	/** Data network id. May be left out when the world has one network. */
	network?: string;
	/**
	 * The device is in neither the emulator's catalogue nor the project's `ic10-mods/` (a mod nobody
	 * has exported yet, say). Its PrefabHash is HASH(prefab), and it accepts every logic property,
	 * readable and writable. Devices only. Mods' devices in `ic10-mods/` don't need it.
	 */
	custom?: boolean;
}

/** A Logic Mirror: where it is, and the device on another network it stands in for. */
export interface MirrorOptions {
	/** Key of the device it stands in for. Left out: none chosen yet, so reads and writes halt the chip. */
	target?: string;
	/** Data network it's on, where chips see it. May be left out when the world has one network. */
	network?: string;
	/** Reference ID: a number or the game's `$hex` form. Default: the next one in a fixed sequence. */
	id?: ReferenceId;
	/** In-game name, for `lbn` / `sbn`. Default: the prefab name. */
	name?: string;
	/** Whether it has power. Default true. Unpowered, reads are 0 and writes are dropped. */
	powered?: boolean;
}

export type Pin = "d0" | "d1" | "d2" | "d3" | "d4" | "d5";

/** A chip housing and its program: exactly one of `file` or `code`. */
export interface HousingOptions<P extends KnownPrefab = "StructureCircuitHousing"> extends DeviceOptions {
	/** Path to an `.ic10` file, relative to `root`. */
	file?: string;
	/** Inline IC10 source. */
	code?: string;
	/** Which device (by key) is on each pin. */
	pins?: Partial<Record<Pin, string>>;
	/** Housing prefab. Default `StructureCircuitHousing`. */
	prefab?: P;
	/** The housing's own logic properties (`db`). */
	props?: PropsOf<P>;
	/** Overrides the world's `linesPerTick` for this chip. */
	linesPerTick?: number;
	/** Overrides the world's `countNonInstructionLines` for this chip. */
	countNonInstructionLines?: boolean;
	/** Overrides the world's `restartClearsState` for this chip. */
	restartClearsState?: boolean;
}

/** Where an extension's device is, and its own logic properties: what every device has. */
export interface KindDeviceOptions extends Omit<DeviceOptions, "custom"> {
	/** Its logic properties, as `device()`'s `props`. */
	props?: Record<string, number>;
}

interface DeviceDecl {
	key: string;
	prefab: string;
	props: Record<string, number>;
	options: DeviceOptions;
	housing?: HousingOptions<KnownPrefab>;
	mirror?: MirrorOptions;
	kind?: { kind: DeviceKind<unknown>; options: unknown };
	/** A stand-in for the idle check (engine/stub.ts). */
	stub?: true;
}

/** First automatic reference ID; later ones count up, skipping any given explicitly. */
const FIRST_AUTO_ID = 0x1001;

/** Declares a world, then builds it. Start with `sim()`. */
export class SimBuilder {
	private readonly networks: string[] = [];
	private readonly decls: DeviceDecl[] = [];
	private readonly atmospheres: AtmosphereEntry[] = [];

	private readonly options: SimOptions;

	constructor(options: SimOptions = {}) {
		this.options = options;
	}

	/** Add a data network. A world without one gets a network called "data". */
	network(id: string): this {
		if (this.networks.includes(id)) throw new Error(`sim: network "${id}" is declared twice`);
		this.networks.push(id);
		return this;
	}

	/**
	 * Add a device. `props` are its logic properties (read-only ones included, as a sensor's
	 * readings); `options` give its reference ID, in-game name and network.
	 */
	device<P extends KnownPrefab>(key: string, prefab: P, props?: PropsOf<P>, options?: DeviceOptions & { custom?: false }): this;
	/** A device in neither the emulator nor the project's ic10-mods/: `custom`, with any property names. */
	device(key: string, prefab: string, props: Record<string, number> | undefined, options: DeviceOptions & { custom: true }): this;
	device(key: string, prefab: string, props: Record<string, number> = {}, options: DeviceOptions = {}): this {
		this.decls.push({ key, prefab, props, options });
		return this;
	}

	/**
	 * Several devices at once, each as `device()`'s arguments, for a table of them:
	 * `.devices(MACHINES.map(([key, prefab, id]) => [key, prefab, { On: 1 }, { id }]))`.
	 */
	devices(list: readonly DeviceSpec[]): this {
		for (const [key, prefab, props = {}, options = {}] of list) {
			this.decls.push({ key, prefab, props: props as Record<string, number>, options });
		}
		return this;
	}

	/**
	 * Add a pipe network, by moles (`gases`) or by `pressure` and `ratios`. Devices attach to it with
	 * `{ pipe }` or `{ ports }`, and read it from then on.
	 */
	pipe(key: string, init: PipeInit): this {
		this.atmospheres.push(makePipe(key, init));
		return this;
	}

	/**
	 * Add a room. With a `volume`, a sealed room; without one, outside air too big to change, given
	 * by `temperature`, `pressure` and `ratios`. Devices attach to it with `{ room }`.
	 */
	room(key: string, init: RoomInit): this {
		this.atmospheres.push(makeRoom(key, init));
		return this;
	}

	/**
	 * Add a Logic Mirror (`StructureLogicMirror`): on its own network it stands in for `target`, a
	 * device on another, as in game. `l` / `s` (and `ld` / `sd` with the mirror's ID) read and write
	 * the target, `PrefabHash` and `ReferenceId` included; batch instructions see a Logic Mirror.
	 */
	mirror(key: string, options: MirrorOptions = {}): this {
		const { id, name, network } = options;
		this.decls.push({
			key,
			prefab: MIRROR_PREFAB,
			props: {},
			options: { ...(id !== undefined && { id }), ...(name !== undefined && { name }), ...(network !== undefined && { network }) },
			mirror: options,
		});
		return this;
	}

	/** Add a chip housing running a program, with devices on its pins. */
	housing<P extends KnownPrefab = "StructureCircuitHousing">(key: string, options: HousingOptions<P>): this {
		this.decls.push({
			key,
			prefab: options.prefab ?? "StructureCircuitHousing",
			props: (options.props ?? {}) as Record<string, number>,
			options,
			housing: options as HousingOptions<KnownPrefab>,
		});
		return this;
	}

	/**
	 * Add a device an extension package makes: `kind` is what the package exports, and `options` are
	 * that kind's own. `device` places it as `device()`'s options do. A kind may host chips of its own,
	 * each found by its own key with `world.chip(key)`, and each with the kind's device as its `db`.
	 */
	add<O>(key: string, kind: DeviceKind<O>, options: O, device: KindDeviceOptions = {}): this {
		const { props = {}, ...place } = device;
		this.decls.push({ key, prefab: kind.prefab, props, options: place, kind: { kind: kind as DeviceKind<unknown>, options } });
		return this;
	}

	/** @internal A stand-in device for the idle check: every logic type and slot, all reading 0. */
	stub(key: string, options: Pick<DeviceOptions, "id" | "network"> = {}): this {
		this.decls.push({ key, prefab: STUB_PREFAB, props: {}, options, stub: true });
		return this;
	}

	async build(): Promise<World> {
		const opts = this.options;
		const networks = this.networks.length > 0 ? this.networks : ["data"];
		const root = opts.root ?? process.cwd();

		const keys = new Set<string>();
		for (const { key } of this.atmospheres) {
			if (keys.has(key)) throw new Error(`sim: "${key}" is declared twice`);
			keys.add(key);
		}
		for (const decl of this.decls) {
			if (keys.has(decl.key)) throw new Error(`sim: "${decl.key}" is declared twice`);
			keys.add(decl.key);
			if (decl.mirror || decl.stub) continue;
			if (decl.housing && decl.options.custom) {
				throw new Error(`sim: housing "${decl.key}": a housing can't be custom`);
			}
			const known = hasDeviceData(decl.prefab) || modPrefabs().has(decl.prefab);
			if (decl.kind) {
				if (!known) {
					throw new Error(
						`sim: "${decl.key}": no device ${decl.prefab} in the emulator or the project's ic10-mods/; add its mod's export there`,
					);
				}
				continue;
			}
			if (decl.housing && !isCatalogued(decl.prefab)) {
				throw new Error(`sim: housing "${decl.key}": the emulator has no housing ${decl.prefab}`);
			}
			if (decl.options.custom && known) {
				throw new Error(`sim: "${decl.key}": ${decl.prefab} is a known device, so it can't be custom; drop { custom: true }`);
			}
			if (!decl.options.custom && !known) {
				throw new Error(
					`sim: "${decl.key}": no device ${decl.prefab} in the emulator or the project's ic10-mods/; for one neither knows, pass { custom: true }`,
				);
			}
		}

		for (const decl of this.decls) decl.kind?.kind.validate?.(decl.kind.options, { key: decl.key, keys });

		const ids = this.assignIds();
		let nextId = Math.max(FIRST_AUTO_ID, ...ids.values()) + 1;
		const kindContext = (decl: DeviceDecl): KindContext => ({
			key: decl.key,
			id: ids.get(decl.key)!,
			prefab: decl.prefab,
			hash: hash(decl.prefab),
			...(decl.options.name !== undefined && { name: decl.options.name }),
			idOf: (key) => ids.get(key),
			program: (source, what) => readProgram(`"${decl.key}" ${what}`, source, root),
			nextId: () => nextId++,
		});
		const specs = this.decls.map((decl): EngineDeviceSpec | EngineHousingSpec => {
			const base: EngineDeviceSpec = {
				key: decl.key,
				id: ids.get(decl.key)!,
				prefab: decl.prefab,
				...(decl.options.name !== undefined && { name: decl.options.name }),
				network: this.networkOf(decl, networks),
				props: decl.props,
				...(modPrefabs().has(decl.prefab) && { mod: modPrefabs().get(decl.prefab)! }),
				...(decl.mirror && { mirror: this.mirrorSpec(decl.key, decl.mirror, ids) }),
				...(decl.kind && { create: () => decl.kind!.kind.create(kindContext(decl), decl.kind!.options) }),
				...(decl.stub && { stub: true }),
			};
			if (!decl.housing) return base;
			const pins: Record<string, number> = {};
			for (const [pin, target] of Object.entries(decl.housing.pins ?? {})) {
				if (!DEVICE_PIN.test(pin)) throw new Error(`sim: "${decl.key}": invalid pin "${pin}" (use d0–d5)`);
				if (target === undefined) continue;
				const id = ids.get(target);
				if (id === undefined) throw new Error(`sim: "${decl.key}" ${pin}: no device "${target}"`);
				// In game a pin can only be set to a device on the housing's own data network.
				const targetNetwork = this.networkOf(this.decls.find((d) => d.key === target)!, networks);
				if (targetNetwork !== base.network) {
					throw new Error(
						`sim: "${decl.key}" ${pin}: "${target}" is on network "${targetNetwork}", not "${base.network}"; a pin only reaches devices on the housing's network`,
					);
				}
				pins[pin] = id;
			}
			return { ...base, code: programOf(decl.key, decl.housing, root), pins };
		});

		const housingSpecs = specs.filter((s): s is EngineHousingSpec => "code" in s);
		const engine = buildEngine({
			networks,
			housings: housingSpecs,
			devices: specs.filter((s) => !("code" in s)),
			seed: opts.seed ?? 1,
		});

		const entries: DeviceEntry[] = specs.map((s) => {
			const decl = this.decls.find((d) => d.key === s.key)!;
			const device = engine.devices.get(s.id)!;
			const attached = this.attachmentsOf(decl);
			if (!attached) return { key: s.key, device, prefab: s.prefab, network: s.network };
			const readings = deviceReadings(s.key, device, s.prefab, attached);
			for (const reading of readings) {
				if (Object.hasOwn(decl.props, reading.prop)) {
					throw new Error(
						`sim: "${s.key}": ${reading.prop} comes from ${reading.source.kind} "${reading.source.key}", so it can't be set on the device; set the ${reading.source.kind}'s gas instead`,
					);
				}
			}
			applyReadings(device, readings);
			return { key: s.key, device, prefab: s.prefab, network: s.network, attached, readings };
		});
		const keyOfId = new Map(specs.map((s) => [s.id, s.key]));
		// Chips run in declaration order: a housing's where it's declared, a host's chips where the host is.
		const chips: ChipDecl[] = [];
		for (const spec of specs) {
			if ("code" in spec) {
				const housing = this.decls.find((d) => d.key === spec.key)!.housing!;
				chips.push({
					key: spec.key,
					id: spec.id,
					source: housing.file ?? "<code>",
					...(housing.file !== undefined && { path: resolve(root, housing.file) }),
					pins: Object.fromEntries(Object.entries(spec.pins).map(([pin, id]) => [pin, keyOfId.get(id)!])),
					...(housing.linesPerTick !== undefined && { linesPerTick: housing.linesPerTick }),
					...(housing.countNonInstructionLines !== undefined && {
						countNonInstructionLines: housing.countNonInstructionLines,
					}),
					...(housing.restartClearsState !== undefined && { restartClearsState: housing.restartClearsState }),
				});
			}
			for (const hosted of engine.hosted.get(spec.id) ?? []) {
				// Snapshots and `world.value` keep chips and devices in one set of keys.
				if (keys.has(hosted.key) || chips.some((c) => c.key === hosted.key)) {
					throw new Error(`sim: "${spec.key}" hosts a chip "${hosted.key}", a key the world already has`);
				}
				chips.push({
					key: hosted.key,
					id: hosted.housing.id,
					source: hosted.source,
					...(hosted.path !== undefined && { path: hosted.path }),
					pins: {},
					host: { key: spec.key, chip: hosted },
				});
			}
		}
		return assembleWorld(engine, entries, chips, opts, this.atmospheres);
	}

	private mirrorSpec(key: string, mirror: MirrorOptions, ids: Map<string, number>): NonNullable<EngineDeviceSpec["mirror"]> {
		const powered = mirror.powered ?? true;
		if (mirror.target === undefined) return { powered };
		if (mirror.target === key) throw new Error(`sim: mirror "${key}" can't be its own target`);
		const target = ids.get(mirror.target);
		if (target === undefined) throw new Error(`sim: mirror "${key}" { target }: no device "${mirror.target}"`);
		return { target, powered };
	}

	/** The pipes and room a device is attached to, or undefined if none. */
	private attachmentsOf(decl: DeviceDecl): Attachments | undefined {
		const { pipe, room, ports = {} } = decl.options;
		if (pipe === undefined && room === undefined && Object.keys(ports).length === 0) return undefined;
		const find = (key: string, kind: AtmosphereEntry["kind"], option: string): AtmosphereEntry => {
			const entry = this.atmospheres.find((a) => a.key === key);
			if (!entry) throw new Error(`sim: "${decl.key}" { ${option} }: no ${kind} "${key}"`);
			if (entry.kind !== kind) throw new Error(`sim: "${decl.key}" { ${option} }: "${key}" is a ${entry.kind}, not a ${kind}`);
			return entry;
		};
		const attached: Attachments = { ports: {} };
		if (pipe !== undefined) attached.pipe = find(pipe, "pipe", "pipe");
		if (room !== undefined) attached.room = find(room, "room", "room");
		for (const [port, key] of Object.entries(ports) as [Port, string | undefined][]) {
			if (key === undefined) continue;
			if (!["input", "input2", "output", "output2"].includes(port)) {
				throw new Error(`sim: "${decl.key}": no port "${port}" (use input, input2, output, output2)`);
			}
			attached.ports[port] = find(key, "pipe", `ports.${port}`);
		}
		return attached;
	}

	/** Explicit IDs first (checking for duplicates), then a fixed sequence for the rest. */
	private assignIds(): Map<string, number> {
		const ids = new Map<string, number>();
		const owner = new Map<number, string>();
		for (const decl of this.decls) {
			if (decl.options.id === undefined) continue;
			const id = parseId(decl.options.id);
			const other = owner.get(id);
			if (other !== undefined) throw new Error(`sim: "${decl.key}" and "${other}" have the same reference ID ${id}`);
			owner.set(id, decl.key);
			ids.set(decl.key, id);
		}
		let next = FIRST_AUTO_ID;
		for (const decl of this.decls) {
			if (ids.has(decl.key)) continue;
			while (owner.has(next)) next++;
			owner.set(next, decl.key);
			ids.set(decl.key, next++);
		}
		return ids;
	}

	private networkOf(decl: DeviceDecl, networks: string[]): string {
		const network = decl.options.network;
		if (network === undefined) {
			if (networks.length === 1) return networks[0]!;
			throw new Error(`sim: "${decl.key}": the world has several networks; say which with { network }`);
		}
		if (!networks.includes(network)) throw new Error(`sim: "${decl.key}": no network "${network}"`);
		return network;
	}
}

/** A chip for `assembleWorld`: its housing's key and ID, and per-chip settings. */
export interface ChipDecl {
	key: string;
	id: number;
	source: string;
	/** Absolute path of the program's file, for `file:` programs. */
	path?: string;
	pins: Record<string, string>;
	linesPerTick?: number;
	countNonInstructionLines?: boolean;
	restartClearsState?: boolean;
	/** A chip a device kind hosts: the host's key, and the kind's hooks. */
	host?: { key: string; chip: HostedChip };
}

/** @internal Wrap built emulator objects in a World with its scheduler. */
export function assembleWorld(
	engine: Engine,
	entries: DeviceEntry[],
	chipDecls: ChipDecl[],
	opts: SimOptions,
	atmospheres: AtmosphereEntry[] = [],
): World {
	const world = new World(entries, new EventQueue(), atmospheres, {
		tickSeconds: opts.tickSeconds ?? GAME_TICK_SECONDS,
		maxTicks: opts.maxTicks ?? 10_000,
		maxLinesPerRun: opts.maxLinesPerRun ?? 1_000_000,
	});
	const chips = chipDecls.map(
		(chip) =>
			new ChipState(
				chip.key,
				engine.chips.get(chip.id)!,
				chip.source,
				chip.linesPerTick ?? opts.linesPerTick ?? 128,
				chip.countNonInstructionLines ?? opts.countNonInstructionLines ?? true,
				chip.pins,
				chip.restartClearsState ?? opts.restartClearsState ?? false,
				chip.path,
				chip.host,
			),
	);
	const gate = opts.debug === false ? undefined : (opts.debug ?? getDefaultDebugGate());
	const scheduler = new Scheduler(
		chips,
		{
			tickSeconds: world.options.tickSeconds,
			maxLinesPerRun: world.options.maxLinesPerRun,
			failOnHalt: opts.failOnHalt ?? false,
			traceLength: opts.traceLength ?? 50,
		},
		{
			world,
			...(gate && { gate }),
			beginTick: (tick) => world.beginTick(tick),
			endTick: (tick) => world.endTick(tick),
			describeWorld: () => world.describeAtmospheres(),
		},
	);
	world.attach(scheduler);
	return world;
}

function programOf(key: string, housing: HousingOptions<KnownPrefab>, root: string): string {
	return readProgram(`housing "${key}"`, housing, root).code;
}

/** A program from `file` (relative to `root`) or inline `code`; `what` names its owner in errors. */
function readProgram(what: string, source: { file?: string; code?: string }, root: string): HostedProgram {
	const { file, code } = source;
	if ((file === undefined) === (code === undefined)) {
		throw new Error(`sim: ${what} needs exactly one of { file } or { code }`);
	}
	if (file === undefined) return { code: code!.replace(/\r\n/g, "\n"), source: "<code>" };
	const path = resolve(root, file);
	return { code: readScript(path), source: file, path };
}

/** Start declaring a world: `sim().device(…).housing(…).build()`. */
export function sim(options?: SimOptions): SimBuilder {
	return new SimBuilder(options);
}
