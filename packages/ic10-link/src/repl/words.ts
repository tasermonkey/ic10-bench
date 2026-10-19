/**
 * A REPL line's words, split as a shell would: on spaces, with "double" or 'single' quotes around a
 * word that has spaces (`map 450 "ic10/Tests/Sync Demo.ic10"`). A backslash is just a character,
 * for Windows' paths. Throws for a quote that isn't closed.
 */
export function splitWords(line: string): string[] {
	const words: string[] = [];
	let word: string | undefined;
	let quote: string | undefined;
	for (const char of line) {
		if (quote !== undefined) {
			if (char === quote) quote = undefined;
			else word += char;
		} else if (char === '"' || char === "'") {
			quote = char;
			word ??= "";
		} else if (/\s/.test(char)) {
			if (word !== undefined) words.push(word);
			word = undefined;
		} else word = (word ?? "") + char;
	}
	if (quote !== undefined) throw new Error(`no closing ${quote}`);
	if (word !== undefined) words.push(word);
	return words;
}
