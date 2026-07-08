/** Persistence — docs/overlay-ui-spec.md §9. Read before first render. */

import type { AnalysisResult } from "./types";

export type Mode = "compact" | "full";
/** Rendered layout, distinct from the persisted `Mode`. "mini" is a forced
 *  fallback display (§2) — never user-selectable, never persisted. */
export type EffectiveMode = Mode | "mini";

const KEYS = {
  mode: "overlay.mode",
  intendedMode: "overlay.intendedMode",
  reduceEffects: "overlay.reduceEffects",
  compactCompressed: "overlay.compactCompressed",
  compareList: "overlay.compareList",
  customPosition: "overlay.customPosition",
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

/** §12 Compare mode entry: an analyzed waystone plus its pin state (pinned
 *  entries survive the rolling window's eviction — KNOWN_ISSUES #8). */
export interface CompareEntry {
  result: AnalysisResult;
  pinned: boolean;
}

/** Compare list persistence (KNOWN_ISSUES #8): survives restarts, unlike
 *  the original session-only list. `AnalysisResult` is plain JSON by
 *  contract (types.ts — a pure data object the overlay only renders), so
 *  a stored entry re-renders identically. Corrupted/legacy payloads are
 *  discarded wholesale rather than half-loaded: an empty compare list is a
 *  fully-working state, a malformed entry mid-render is not. */
export function loadCompareList(): CompareEntry[] {
  const raw = localStorage.getItem(KEYS.compareList);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ok = parsed.every(
      (e: unknown) =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as CompareEntry).pinned === "boolean" &&
        typeof (e as CompareEntry).result?.waystone?.name === "string" &&
        typeof (e as CompareEntry).result?.heat?.score === "number" &&
        typeof (e as CompareEntry).result?.heat?.verdict === "string",
    );
    return ok ? (parsed as CompareEntry[]).slice(0, 3) : [];
  } catch {
    return [];
  }
}

export function saveCompareList(entries: CompareEntry[]): void {
  try {
    localStorage.setItem(KEYS.compareList, JSON.stringify(entries));
  } catch {
    // Quota/serialization failure — compare persistence is a convenience,
    // never worth breaking the analyze flow over.
  }
}

/** Drag-to-reposition (placement.ts): a user-dragged window position,
 *  logical px, restored instead of the default top-right anchor on
 *  startup. Cleared (not remapped) on any real display/DPI/monitor change
 *  — placement.ts's handleDisplayChange falls back to placeTopRight()
 *  rather than risk placing a stale position off-screen on new geometry. */
export interface CustomPosition {
  x: number;
  y: number;
}

export function loadCustomPosition(): CustomPosition | null {
  const raw = localStorage.getItem(KEYS.customPosition);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as CustomPosition).x === "number" &&
      typeof (parsed as CustomPosition).y === "number" &&
      Number.isFinite((parsed as CustomPosition).x) &&
      Number.isFinite((parsed as CustomPosition).y)
    ) {
      return parsed as CustomPosition;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCustomPosition(pos: CustomPosition): void {
  localStorage.setItem(KEYS.customPosition, JSON.stringify(pos));
}

export function clearCustomPosition(): void {
  localStorage.removeItem(KEYS.customPosition);
}
