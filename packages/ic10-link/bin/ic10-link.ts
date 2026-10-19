#!/usr/bin/env node
/** The ic10-link command line (src/cli.ts). */
import { select } from "@inquirer/prompts";
import { wantsColor } from "@tasermonkey/ic10-lint";
import { runCli } from "../src/cli.ts";

// Ctrl+C stops `watch` after the pass it's in, rather than in the middle of writing a file.
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());

/** Asks in the terminal, with a list to pick from; only when someone is there to answer. */
async function choose(message: string, choices: string[]): Promise<number> {
	try {
		return await select({ message, choices: choices.map((name, value) => ({ name, value })), loop: false });
	} catch (error) {
		// Ctrl+C at the prompt: stop there, rather than go on to the next question.
		if (error instanceof Error && ["ExitPromptError", "AbortPromptError"].includes(error.name)) throw new Error("Stopped.");
		throw error;
	}
}

// process.exitCode rather than process.exit(): exiting while output is still being written
// crashes Node on Windows.
process.exitCode = await runCli(process.argv.slice(2), {
	cwd: process.cwd(),
	out: (text) => console.log(text),
	choose: process.stdin.isTTY && process.stdout.isTTY ? choose : undefined,
	signal: stop.signal,
	color: wantsColor(),
	terminal: { input: process.stdin, output: process.stdout },
});
