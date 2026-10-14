import { defineConfig } from "vitest/config";

export default defineConfig({
	// Resolve @tasermonkey/ic10 to its TypeScript sources (the "source" export condition).
	resolve: { conditions: ["source"] },
	ssr: { resolve: { conditions: ["source"] } },
	test: {
		name: "ic10-lint",
		include: ["test/**/*.test.ts"],
	},
});
