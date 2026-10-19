/**
 * The IC10 tools' command lines (ic10-lint, IC10 Bench, ic10-link), all on commander, set up one
 * way: commander writes through the caller's `out` and never exits on its own, so a command line
 * can run inside another one (`ic10-bench lint`) or a REPL, and in tests.
 */
import { Command, CommanderError } from "commander";

/**
 * Builds the command line named `name` (`build` adds its options, arguments, commands and
 * actions, each action calling `exit` with its code), runs it on `argv`, and returns the exit code:
 * the action's, 0 for `--help`, and 2 for a bad command line, or for an error an action throws,
 * whose message is printed.
 */
export async function runProgram(
	name: string,
	argv: string[],
	out: (text: string) => void,
	build: (program: Command, exit: (code: number) => void) => void,
): Promise<number> {
	let code = 0;
	// Commander ends what it writes with a newline, and `out` adds one.
	const write = (text: string) => out(text.replace(/\n$/, ""));
	// Set before `build` adds commands, so they have it too.
	const program = new Command(name)
		.configureOutput({ writeOut: write, writeErr: write })
		.showHelpAfterError(`(${name} --help for the usage)`)
		.exitOverride();
	build(program, (exit) => (code = exit));
	try {
		await program.parseAsync(argv, { from: "user" });
		return code;
	} catch (error) {
		// Commander has said what was wrong: 0 for --help, else a bad command line.
		if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
		out((error as Error).message);
		return 2;
	}
}
