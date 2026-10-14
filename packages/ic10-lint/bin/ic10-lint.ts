#!/usr/bin/env node
/** The ic10-lint command line (src/cli.ts). */
import { runCli, wantsColor } from "../src/cli.ts";

// process.exitCode rather than process.exit(): exiting while output is still being written
// crashes Node on Windows.
process.exitCode = await runCli(process.argv.slice(2), {
	cwd: process.cwd(),
	out: (text) => console.log(text),
	color: wantsColor(),
});
