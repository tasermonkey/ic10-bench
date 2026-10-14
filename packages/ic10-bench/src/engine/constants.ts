/**
 * Game enums a test compares devices' values with, from the emulator's game data (the same names
 * a script uses: `Color.Green`, `Vent.Inward`).
 */
import { GROUPED_CONSTS } from "@tasermonkey/ic10";

/** Light and display colours: `Color.Green` is 2, as `s d0 Color Color.Green` writes. */
export const Color = GROUPED_CONSTS.Color;

/** An active or powered vent's `Mode`: `VentMode.Outward` (0) pumps into the room, `VentMode.Inward` (1) out of it. */
export const VentMode = GROUPED_CONSTS.Vent;

/**
 * A console LED display's `Mode` (`DisplayMode` in IC10): `LedMode.Default` (0) a number,
 * `LedMode.Power` (2) watts, `LedMode.String` (10) text from `STR("…")`, and so on.
 */
export const LedMode = GROUPED_CONSTS.DisplayMode;
