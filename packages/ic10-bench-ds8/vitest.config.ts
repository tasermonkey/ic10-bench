import { fileURLToPath } from "node:url";
// From source here; a project that installs the packages imports "@tasermonkey/ic10-bench/config".
import { defineIc10Config } from "../ic10-bench/src/config.ts";

export default defineIc10Config(
	{
		// Resolve @tasermonkey/ic10 and @tasermonkey/ic10-bench to their TypeScript sources (the
		// "source" export condition).
		resolve: { conditions: ["source"] },
		ssr: { resolve: { conditions: ["source"] } },
		test: {
			name: "ic10-bench-ds8",
			include: ["test/**/*.test.ts"],
		},
	},
	// A project of its own, whose ic10-mods/ has the rack's catalogue entry.
	{ project: fileURLToPath(new URL("./test/fixtures/project", import.meta.url)) },
);
