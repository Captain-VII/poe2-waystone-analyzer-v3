/** Persistence — docs/overlay-ui-spec.md §9. Read before first render. */

export type Mode = "compact" | "full";
/** Rendered layout, distinct from the persisted `Mode`. "mini" is a forced
 *  fallback display (§2) — never user-selectable, never persisted. */
export type EffectiveMode = Mode | "mini";

const KEYS = {
  mode: "overlay.mode",
  intendedMode: "overlay.intendedMode",
  reduceEffects: "overlay.reduceEffects",
  compactCompressed: "overlay.compactCompressed",
} as const;

export function loadMode(): Mode {
  return localStorage.getItem(KEYS.mode) === "full" ? "full" : "compact";
}

/** `userInitiated` distinguishes a real toggle from a forced fallback:
 *  only user toggles update intendedMode (§9). */
export function saveMode(mode: Mode, userInitiated = true): void {
  localStorage.setItem(KEYS.mode, mode);
  if (userInitiated) localStorage.setItem(KEYS.intendedMode, mode);
}

export function loadIntendedMode(): Mode {
  return localStorage.getItem(KEYS.intendedMode) === "full" ? "full" : "compact";
}

export function loadReduceEffects(): boolean {
  return localStorage.getItem(KEYS.reduceEffects) === "true";
}

export function saveReduceEffects(enabled: boolean): void {
  localStorage.setItem(KEYS.reduceEffects, String(enabled));
}

/** §2 height contingency: if 392px Compact overlaps the real game HUD,
 *  compress to ~360px by trimming air only (never drops the score,
 *  verdict chip, or any of the three tablets). Off by default. */
export function loadCompactCompressed(): boolean {
  return localStorage.getItem(KEYS.compactCompressed) === "true";
}

export function saveCompactCompressed(enabled: boolean): void {
  localStorage.setItem(KEYS.compactCompressed, String(enabled));
}
