import type { Cancel } from "./events.ts";
import type { World } from "./world.ts";

/**
 * Press a button: set `prop` (default `Activate`) to 1 now, and back to 0 at the start of the next
 * tick. A press in game is a one-tick pulse, so a script that reads the button every tick sees it
 * once, and one that doesn't can miss it. Returns a function that cancels the release.
 */
export function press(world: World, device: string, prop = "Activate"): Cancel {
	world.device(device).set(prop, 1);
	return world.at({ tick: world.tick + 1 }, (w) => w.device(device).set(prop, 0), { label: `release ${device}.${prop}` });
}
