/**
 * `ic10-link repl`: a prompt that runs the commands one after another, as `runCli` does, with the
 * station given at the start. `watch` runs in the background, its lines printed above the prompt,
 * until `stop`.
 *
 * Every line typed goes through one queue, for the prompt and the commands' questions alike. A
 * command's question (a relabelled chip's files) is the same pick list as on the command line
 * (`io.choose`, @inquirer/prompts), with the REPL's readline closed while it's open, since two
 * readers of the terminal would each get the keys; without a terminal, it's asked by number.
 */
import { clearLine, createInterface, cursorTo } from "node:readline";
import type { CliIo } from "../cli.ts";
import { splitWords } from "./words.ts";

/** The REPL's input and output: the terminal, or any streams (a pipe, a test). */
export interface Terminal {
	input: NodeJS.ReadableStream;
	output: NodeJS.WritableStream & { isTTY?: boolean };
}

export interface ReplOptions {
	terminal: Terminal;
	/** Runs one command line; `runCli`. */
	run: (argv: string[], io: CliIo) => Promise<number>;
	/** The commands `run` has. */
	commands: string[];
	/** Those that take `--chipdata` and `--station`. */
	withStation: string[];
	/** `--chipdata` and `--station` as the REPL was started with, for each command that gives neither. */
	defaults: { chipdata?: string; station?: string };
}

const PROMPT = "ic10-link> ";
const PROMPT_WATCHING = "ic10-link (watching)> ";

/** The REPL's own commands, beside `run`'s. */
const OWN = ["stop", "exit", "quit"];

const ABOUT = `Run the commands as on the command line, without "ic10-link": help lists them.
watch runs in the background, and stop ends it. exit, quit or Ctrl+D leaves.`;

/** A background `watch`: stopping it aborts its signal, and `done` settles once it has stopped. */
interface Watching {
	stop: AbortController;
	done: Promise<number>;
}

/** The words with the REPL's `--chipdata` and `--station` added, unless the line gives its own. */
function withDefaults(words: string[], defaults: ReplOptions["defaults"]): string[] {
	const argv = [...words];
	for (const [name, value] of Object.entries(defaults)) {
		if (value !== undefined && !words.includes(`--${name}`)) argv.push(`--${name}`, value);
	}
	return argv;
}

/** Runs the REPL until `exit`, `quit` or the end of the input; returns the exit code. */
export async function repl(io: CliIo, options: ReplOptions): Promise<number> {
	const { input, output } = options.terminal;
	const tty = output.isTTY === true;
	const names = [...options.commands, "help", ...OWN];
	const complete = (line: string): [string[], string] => {
		if (/\s/.test(line.trimStart())) return [[], line];
		const word = line.trimStart();
		const hits = names.filter((name) => name.startsWith(word));
		return [hits.length > 0 ? hits : names, word];
	};

	// Every line typed, in order, for the prompt and for the commands' questions alike.
	const lines: string[] = [];
	let ended = false;
	let wake: (() => void) | undefined;
	let waiting = false;
	let history: string[] = [];
	let handingOver = false;

	/**
	 * The readline on the terminal. It's closed while a pick list has the terminal (`choose`), and
	 * opened again after, with the history so far.
	 */
	const open = () => {
		const reader = createInterface({ input, output, terminal: tty, prompt: PROMPT, history: [...history], removeHistoryDuplicates: true, completer: complete });
		reader.on("history", (lines) => (history = lines));
		reader.on("line", (line) => {
			lines.push(line);
			wake?.();
		});
		reader.on("close", () => {
			if (handingOver) return;
			ended = true;
			wake?.();
		});
		// Ctrl+C at the prompt drops what's typed; it doesn't leave (exit and Ctrl+D do).
		reader.on("SIGINT", () => {
			if (!waiting) return;
			reader.write(null, { ctrl: true, name: "e" });
			reader.write(null, { ctrl: true, name: "u" });
			output.write("\n");
			reader.prompt();
		});
		return reader;
	};
	let terminal = open();

	/** Prompts, and waits for the next line; undefined at the end of the input. */
	const ask = async (prompt: string): Promise<string | undefined> => {
		// Once the input has ended (Ctrl+D, the end of a piped script), only what's queued is left.
		if (!ended) {
			terminal.setPrompt(prompt);
			terminal.prompt();
		}
		waiting = true;
		while (lines.length === 0 && !ended) await new Promise<void>((resolve) => (wake = resolve));
		waiting = false;
		return lines.shift();
	};

	/** Lines printed while a pick list has the terminal, held until it's done, so they don't garble it. */
	let held: string[] | undefined;
	/** Prints a line; while the prompt waits, above it, and the prompt is drawn again with what's typed. */
	const print = (text: string) => {
		if (held) held.push(text);
		else if (waiting && tty && !ended) {
			clearLine(output, 0);
			cursorTo(output, 0);
			output.write(`${text}\n`);
			terminal.prompt(true);
		} else output.write(`${text}\n`);
	};

	/**
	 * A command's question. In a terminal, the pick list `io.choose` has (the arrow keys), with the
	 * terminal handed over to it: two readers of the keys would each get them. Otherwise (a pipe,
	 * a script), at the prompt, by number.
	 */
	const choose = async (question: string, choices: string[]): Promise<number> => {
		if (!tty || !io.choose || ended) return chooseByNumber(question, choices);
		handingOver = true;
		terminal.close();
		handingOver = false;
		held = [];
		try {
			return await io.choose(question, choices);
		} finally {
			const lines = held;
			held = undefined;
			terminal = open();
			for (const line of lines) print(line);
		}
	};

	/** A command's question, asked at the prompt: the choices by number. */
	const chooseByNumber = async (question: string, choices: string[]): Promise<number> => {
		print(question);
		for (const [i, choice] of choices.entries()) print(`  ${i + 1}) ${choice}`);
		for (;;) {
			const answer = await ask(`[1-${choices.length}]: `);
			if (answer === undefined) throw new Error("Stopped.");
			const choice = Number(answer.trim());
			if (Number.isInteger(choice) && choice >= 1 && choice <= choices.length) return choice - 1;
		}
	};

	let watching: Watching | undefined;
	const stopWatching = async () => {
		if (!watching) return;
		const { stop, done } = watching;
		stop.abort();
		await done;
		watching = undefined;
		print("Stopped watching.");
	};

	const commandIo: CliIo = { ...io, out: print, choose, stopWith: "stop" };
	print(ABOUT);
	for (;;) {
		const line = await ask(watching ? PROMPT_WATCHING : PROMPT);
		if (line === undefined) break;
		let words: string[];
		try {
			words = splitWords(line);
		} catch (error) {
			print((error as Error).message);
			continue;
		}
		const [name] = words;
		if (name === undefined) continue;
		if (name === "exit" || name === "quit") break;
		if (name === "stop") {
			if (watching) await stopWatching();
			else print("Not watching.");
			continue;
		}
		if (name === "repl") {
			print("Already in the REPL.");
			continue;
		}
		if (name === "once" && watching) {
			print("watch is running, and already does what once does. stop it first.");
			continue;
		}
		if (name === "watch" && watching) {
			print("Already watching. stop it first.");
			continue;
		}
		const argv = options.withStation.includes(name) ? withDefaults(words, options.defaults) : words;

		if (name === "watch") {
			const stop = new AbortController();
			const handle: Watching = { stop, done: options.run(argv, { ...commandIo, signal: stop.signal }) };
			watching = handle;
			// A watch that couldn't start (no station, a bad option) has said why, and is over.
			void handle.done.then(() => {
				if (watching === handle) watching = undefined;
			});
			await new Promise((resolve) => setImmediate(resolve));
			continue;
		}
		await options.run(argv, commandIo);
		if (name === "help" || words.includes("--help") || words.includes("-h")) print(`\n${ABOUT}`);
	}

	await stopWatching();
	if (!ended) terminal.close();
	return 0;
}
