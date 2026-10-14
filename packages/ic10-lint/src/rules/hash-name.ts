import { DEVICES, ITEMS } from "@tasermonkey/ic10";
import { BATCH_OPS } from "../batch-ops.ts";
import { instruction } from "../source.ts";
import type { BatchOpCatalog, Rule } from "../types.ts";

const HASH = /^HASH\("(.*)"\)$/;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+|\$[0-9A-Fa-f]+|%[01]+)$/;

/** Every prefab the game has (the emulator's devices and items), with the catalogue's mods. */
function knownPrefabs(catalog?: BatchOpCatalog): Set<string> {
	const names = new Set<string>();
	for (const device of Object.values(DEVICES)) if (device.PrefabName) names.add(device.PrefabName);
	for (const item of ITEMS) if (item.PrefabName) names.add(item.PrefabName);
	for (const name of Object.keys(catalog?.prefabs ?? {})) names.add(name);
	return names;
}

/**
 * The first words of prefab names ("Structure", "Item", "ModularDevice" → "Modular", …), so a name
 * that starts like one but isn't one stands out. Names of devices ("Vent 1", "EchoStar") don't.
 */
function prefabPrefixes(prefabs: Set<string>): Set<string> {
	const counts = new Map<string, number>();
	for (const name of prefabs) {
		const word = /^[A-Z][a-z]+/.exec(name)?.[0];
		if (word) counts.set(word, (counts.get(word) ?? 0) + 1);
	}
	return new Set([...counts].filter(([, n]) => n >= 5).map(([word]) => word));
}

let gamePrefabs: { names: Set<string>; prefixes: Set<string> } | undefined;

/**
 * `HASH("123")` hashes the text "123", not the number: an error. `HASH("StructureActivVent")`, a
 * name shaped like a prefab that the game (and the catalogue's mods) doesn't have, is a warning. A
 * batch instruction's type is the `batch-ops` rule's, which reports it as an error.
 */
export const hashName: Rule = {
	id: "hash-name",
	defaultSeverity: "error",
	description: 'HASH() of a number (HASH("5")), or of a prefab-like name the game doesn\'t have',
	check(context) {
		gamePrefabs ??= (() => {
			const names = knownPrefabs();
			return { names, prefixes: prefabPrefixes(names) };
		})();
		const mods = Object.keys(context.catalog?.prefabs ?? {});
		const known = (name: string) => gamePrefabs!.names.has(name) || mods.includes(name);

		for (const line of context.script.lines) {
			const ins = instruction(line);
			const batch = ins && BATCH_OPS[ins.op];
			line.tokens.forEach((token, i) => {
				const name = HASH.exec(token)?.[1];
				if (name === undefined) return;
				const column = line.columns[i]!;
				if (NUMBER.test(name)) {
					context.report({ line: line.index, column, message: `${token} hashes the text "${name}", not the number ${name}` });
					return;
				}
				if (known(name) || !/^\w+$/.test(name)) return;
				if (batch && context.catalog && i === batch.type + 1) return; // batch-ops reports it
				const word = /^[A-Z][a-z]+/.exec(name)?.[0];
				if (word && gamePrefabs!.prefixes.has(word)) {
					context.report({
						line: line.index,
						column,
						severity: "warning",
						message: `${token} looks like a prefab, but the game has no prefab ${name}`,
					});
				}
			});
		}
	},
};
