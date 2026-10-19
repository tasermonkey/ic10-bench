#!/usr/bin/env node
/** The ic10-bench command line (src/cli/cli.ts). */
import { createInterface } from "node:readline/promises";
import { wantsColor } from "@tasermonkey/ic10-lint";
import { runCli } from "../src/cli/cli.ts";

/** Asks a yes/no question in the terminal. */
async function ask(question: string): Promise<boolean> {
	const prompt = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return /^y(es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim());
	} finally {
		prompt.close();
	}
}

// process.exitCode rather than process.exit(): exiting while output is still being written
// crashes Node on Windows.
process.exitCode = await runCli(process.argv.slice(2), {
	out: (text) => console.log(text),
	ask: process.stdin.isTTY ? ask : undefined,
	color: wantsColor(),
});
