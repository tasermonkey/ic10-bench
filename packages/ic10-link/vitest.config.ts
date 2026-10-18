import { defineConfig } from "vitest/config";

export default defineConfig({
	// Resolve @tasermonkey/ic10-lint to its TypeScript sources (the "source" export condition).
	resolve: { conditions: ["source"] },
	ssr: { resolve: { conditions: ["source"] } },
	test: {
		name: "ic10-link",
		include: ["test/**/*.test.ts"],
	},
});
