/** What the command line and the REPL share: what a command is given besides its arguments. */
import type { FindOptions } from "./game/chipdata.ts";
import type { GateOptions } from "./sync/gate.ts";

/** The REPL's input and output: the terminal, or any streams (a pipe, a test). */
export interface Terminal {
	input: NodeJS.ReadableStream;
	output: NodeJS.WritableStream & { isTTY?: boolean };
}

export interface CliIo extends Pick<GateOptions, "findTests" | "runTests"> {
	/** The project: where stations/ is. */
	cwd: string;
	out: (text: string) => void;
	/** Asks the player to pick one of `choices`, and returns its index. Only in an interactive terminal; throws if they cancel. */
	choose?: (question: string, choices: string[]) => Promise<number>;
	env?: NodeJS.ProcessEnv;
	/** The Documents folder; for tests. Default reads Windows' registry. */
	documents?: FindOptions["documents"];
	/** Stops `watch`. */
	signal?: AbortSignal;
	/** What stops `watch`, as its first line says. Default `Ctrl+C`; the REPL's `stop`. */
	stopWith?: string;
	/** Colour the output (ic10-lint's `wantsColor()`). Default off. */
	color?: boolean;
	/** Where `repl` reads and writes; without it, `repl` can't run. */
	terminal?: Terminal;
}
