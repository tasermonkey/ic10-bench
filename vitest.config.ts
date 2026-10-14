import { defineConfig } from "vitest/config";
// From source here; a project that installs the package imports "@tasermonkey/ic10-bench/config".
import { defineIc10Config } from "./packages/ic10-bench/src/config.ts";

export default defineConfig({
	test: {
		// `npm run coverage`: the packages' own code (the fork has its own tests, `npm run test:fork`).
		coverage: {
			provider: "v8",
			include: ["packages/*/src/**/*.ts", "packages/*/bin/**/*.ts"],
			reporter: ["text-summary", "html"],
		},
		projects: [
			// The linter's own tests, with their fixture project (packages/ic10-lint/vitest.config.ts).
			"packages/ic10-lint",
			// The harness's own tests, with their fixture project (packages/ic10-bench/vitest.config.ts).
			"packages/ic10-bench",
			defineIc10Config({
				// Resolve @tasermonkey/ic10 and @tasermonkey/ic10-bench to their TypeScript sources (the
				// "source" export condition), so tests run against the checkouts without building them.
				resolve: { conditions: ["source"] },
				ssr: { resolve: { conditions: ["source"] } },
				test: {
					name: "vscode",
					include: [
						"packages/vscode/test/**/*.test.ts",
						// The debugger's playground: one test per feature, to try it on (packages/vscode/examples/README.md).
						"packages/vscode/examples/*.test.ts",
					],
				},
			}),
		],
	},
});
