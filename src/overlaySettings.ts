/** Settings-panel-only persistence: insights visibility, opacity, scale.
 *  Mode (compact/full) stays owned by settings.ts's loadMode/saveMode and
 *  main.ts's existing toggleMode — the Settings panel just calls that, it
 *  doesn't duplicate the storage. */

const KEYS = {
  showInsights: "overlay.showInsights",
  opacity: "overlay.opacity",
  scale: "overlay.scale",
} as const;

export const OPACITY_MIN = 60;
export const OPACITY_MAX = 100;
export const OPACITY_DEFAULT = 96; // matches panel.css's prior hardcoded 0.96

export const SCALE_MIN = 0.8;
export const SCALE_MAX = 1.05; // one reachable step above SCALE_DEFAULT, aligned to step=0.05
export const SCALE_DEFAULT = 1;

/** Guards against corrupted/hand-edited localStorage (missing key, empty
 *  string, non-numeric, NaN, or out-of-range) — clamps into range rather
 *  than just falling back, so a slightly-off stored value still lands
 *  close to what the user picked. A missing/empty key always means "use
 *  default", not "clamp 0/NaN" — `raw` is checked before any numeric
 *  coercion. */
function loadClamped(key: string, min: number, max: number, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function loadShowInsights(): boolean {
  return localStorage.getItem(KEYS.showInsights) !== "false"; // default: shown
}

export function saveShowInsights(show: boolean): void {
  localStorage.setItem(KEYS.showInsights, String(show));
}

export function loadOpacity(): number {
  return loadClamped(KEYS.opacity, OPACITY_MIN, OPACITY_MAX, OPACITY_DEFAULT);
}

export function saveOpacity(pct: number): void {
  localStorage.setItem(KEYS.opacity, String(pct));
}

export function loadScale(): number {
  return loadClamped(KEYS.scale, SCALE_MIN, SCALE_MAX, SCALE_DEFAULT);
}

export function saveScale(scale: number): void {
  localStorage.setItem(KEYS.scale, String(scale));
}
