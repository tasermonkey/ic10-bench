/**
 * The fixture project's scripts, checked as a project's own test file would. Its script says in
 * its `.json` that it runs in the rack (`"host": "StructureServerRack"`), so its idle check runs it
 * in a rack's socket: `get r0 db 4127` (a status register) would overflow a circuit housing's
 * 512-entry stack.
 */
import { join } from "node:path";
import { describeScriptChecks } from "@tasermonkey/ic10-bench/checks";
import { serverRack } from "../src/index.ts";

describeScriptChecks({ root: join(import.meta.dirname, "fixtures", "project"), extensions: [serverRack] });
