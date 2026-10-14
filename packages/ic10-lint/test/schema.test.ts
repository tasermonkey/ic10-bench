import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GAME_LIMITS } from "../src/limits.ts";
import { RULES } from "../src/rules/index.ts";

const schema = JSON.parse(readFileSync(join(import.meta.dirname, "..", "schema.json"), "utf8"));
const override = schema.properties.overrides.additionalProperties;

describe("schema.json", () => {
	it("names every rule, with its default, and IC10 Bench's idle", () => {
		const rules = schema.definitions.rules.properties;
		expect(Object.keys(rules)).toEqual([...RULES.map((r) => r.id), "idle"]);
		for (const rule of RULES) {
			const setting = rule.defaultOff ? "off" : rule.defaultSeverity === "warning" ? "warn" : rule.defaultSeverity;
			expect(rules[rule.id].description, rule.id).toMatch(new RegExp(`Default ${setting}\\.$`));
		}
	});

	it("takes limits only over the game's", () => {
		const limits = override.properties.limits.properties;
		expect(Object.fromEntries(Object.entries(limits).map(([name, l]) => [name, (l as { minimum: number }).minimum - 1]))).toEqual(GAME_LIMITS);
	});

	it("takes the severities loadConfig does, and needs a reason", () => {
		expect(schema.definitions.severity.enum).toEqual(["error", "warn", "warning", "info", "off"]);
		expect(override.required).toEqual(["reason"]);
	});
});
