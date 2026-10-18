/** What depends on the operating system: where the Documents folder is. */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The Documents folder: Windows' own, from the registry (`windowsDocuments`), else
 * `<home>/Documents`. `windows` stands in for the registry in tests.
 */
export function documentsFolder(env: NodeJS.ProcessEnv = process.env, windows: () => string | undefined = () => windowsDocuments(env)): string {
	return windows() ?? join(homedir(), "Documents");
}

/**
 * Windows' Documents folder, from the registry; undefined on other systems. It can be moved
 * (OneDrive moves it to `<OneDrive>\Documents`), so `%USERPROFILE%\Documents` isn't always it.
 */
export function windowsDocuments(env: NodeJS.ProcessEnv = process.env): string | undefined {
	if (process.platform !== "win32") return undefined;
	try {
		const output = execFileSync(
			"reg",
			["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "/v", "Personal"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		);
		const value = /Personal\s+REG_\w+\s+(.+)/.exec(output)?.[1]?.trim();
		return value ? expandWindowsVariables(value, env) : undefined;
	} catch {
		return undefined;
	}
}

/** `%USERPROFILE%\Documents` → `C:\Users\me\Documents`; unknown variables are left as they are. */
export function expandWindowsVariables(text: string, env: NodeJS.ProcessEnv): string {
	return text.replace(/%([^%]+)%/g, (whole, name: string) => {
		const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
		return key ? env[key]! : whole;
	});
}
