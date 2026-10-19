/**
 * The environment variable naming a project's folder, which `defineIc10Config` sets.
 *
 * On its own, with no imports, because config.ts needs it: the repo's vitest.config.ts loads
 * config.ts from source, and Vite resolves any package that chain imports to its build, which CI
 * hasn't made yet. Keep config.ts's imports to Node, Vitest and files like this one.
 */
export const ROOT_ENV = "IC10_BENCH_ROOT";
