#!/usr/bin/env node
/** The ic10-link command line (src/cli.ts). */
import { createInterface } from "node:readline/promises";
import { wantsColor } from "@tasermonkey/ic10-lint";
import { runCli } from "../src/cli.ts";

/** Asks in the terminal; only when someone is there to answer. */
async function ask(question: string): Promise<string> {
	const terminal = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await terminal.question(question);
	} finally {
		terminal.close();
	}
}

// Ctrl+C stops `watch` after the pass it's in, rather than in the middle of writing a file.
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());

// process.exitCode rather than process.exit(): exiting while output is still being written
// crashes Node on Windows.
process.exitCode = await runCli(process.argv.slice(2), {
	cwd: process.cwd(),
	out: (text) => console.log(text),
	ask: process.stdin.isTTY && process.stdout.isTTY ? ask : undefined,
	signal: stop.signal,
	color: wantsColor(),
});
