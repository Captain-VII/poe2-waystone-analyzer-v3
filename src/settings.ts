/** Persistence — docs/overlay-ui-spec.md §9. Read before first render. */

/** Rendered layout. "mini" is a forced fallback display (§2) for screens
 *  too small for Full — never user-selectable, never persisted. Compact
 *  mode (the old vertical quick-decision card) was removed; Full is now
 *  the only intended layout. */
export type EffectiveMode = "full" | "mini";

const KEYS = {
  reduceEffects: "overlay.reduceEffects",
  customPosition: "overlay.customPosition",
  sessionStats: "overlay.sessionStats",
  sessionHistory: "overlay.sessionHistory",
} as const;

export function loadReduceEffects(): boolean {
  return localStorage.getItem(KEYS.reduceEffects) === "true";
}

export function saveReduceEffects(enabled: boolean): void {
  localStorage.setItem(KEYS.reduceEffects, String(enabled));
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

/** Session stats: one latest score per analyzed waystone name — keyed so a
 *  re-analysis (same map after crafting, or an accidental double Ins)
 *  updates in place instead of inflating the count. "Session" means "since
 *  the user last hit Réinitialiser", not "since app launch": stats survive
 *  restarts (and the KNOWN_ISSUES #1 black-screen relaunch) so a farming
 *  session isn't lost to a crash. */
export interface SessionStats {
  scores: Record<string, number>;
}

/** What the Settings panel actually displays, derived from SessionStats. */
export interface SessionStatsView {
  count: number;
  avg: number | null;
  best: { name: string; score: number } | null;
}

export function summarizeSessionStats(stats: SessionStats): SessionStatsView {
  const entries = Object.entries(stats.scores);
  if (entries.length === 0) return { count: 0, avg: null, best: null };
  let sum = 0;
  let best = entries[0]!;
  for (const e of entries) {
    sum += e[1];
    if (e[1] > best[1]) best = e;
  }
  return {
    count: entries.length,
    avg: sum / entries.length,
    best: { name: best[0], score: best[1] },
  };
}

export function loadSessionStats(): SessionStats {
  const raw = localStorage.getItem(KEYS.sessionStats);
  if (!raw) return { scores: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    const scores = (parsed as SessionStats)?.scores;
    if (
      typeof scores === "object" &&
      scores !== null &&
      !Array.isArray(scores) &&
      Object.values(scores).every((v) => typeof v === "number" && Number.isFinite(v))
    ) {
      return { scores: scores as Record<string, number> };
    }
    return { scores: {} };
  } catch {
    return { scores: {} };
  }
}

export function saveSessionStats(stats: SessionStats): void {
  try {
    localStorage.setItem(KEYS.sessionStats, JSON.stringify(stats));
  } catch {
    // Stats are a convenience, never worth breaking the analyze flow over.
  }
}

export function clearSessionStats(): void {
  localStorage.removeItem(KEYS.sessionStats);
}

/** One archived farming session, written when the user hits the Session
 *  "Reset" button (see `archiveSession`) — `count`/`avg`/`best` are only
 *  ever non-empty at archive time (`summarizeSessionStats` guards that),
 *  so `best` is never null here even though it can be on the live view. */
export interface SessionHistoryEntry {
  endedAt: string; // ISO timestamp, when Reset was pressed
  count: number;
  avg: number;
  best: { name: string; score: number };
}

const MAX_HISTORY_ENTRIES = 50;

export function loadSessionHistory(): SessionHistoryEntry[] {
  const raw = localStorage.getItem(KEYS.sessionHistory);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is SessionHistoryEntry => {
      const entry = e as Partial<SessionHistoryEntry> | null;
      return (
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.endedAt === "string" &&
        typeof entry.count === "number" &&
        typeof entry.avg === "number" &&
        typeof entry.best === "object" &&
        entry.best !== null &&
        typeof entry.best.name === "string" &&
        typeof entry.best.score === "number"
      );
    });
  } catch {
    return [];
  }
}

export function saveSessionHistory(history: SessionHistoryEntry[]): void {
  try {
    localStorage.setItem(KEYS.sessionHistory, JSON.stringify(history.slice(-MAX_HISTORY_ENTRIES)));
  } catch {
    // History is a convenience, never worth breaking the reset flow over.
  }
}

/** Archives the current session into persisted history, then returns the
 *  updated list — called right before a Reset empties the live counters, so
 *  Reset moves data into history instead of discarding it. A no-op reset
 *  (nothing analyzed yet since the last one) doesn't create an empty
 *  entry. */
export function archiveSession(stats: SessionStats): SessionHistoryEntry[] {
  const view = summarizeSessionStats(stats);
  const history = loadSessionHistory();
  if (view.count === 0 || view.avg === null || view.best === null) return history;
  const updated = [...history, { endedAt: new Date().toISOString(), count: view.count, avg: view.avg, best: view.best }].slice(
    -MAX_HISTORY_ENTRIES,
  );
  saveSessionHistory(updated);
  return updated;
}

/** CSV for the Session "Export" button — one row per archived session,
 *  oldest first (spreadsheet-natural chronological order). CRLF line
 *  endings and quoted text fields for Excel; waystone names can contain
 *  commas/quotes so they're always quoted. */
export function exportSessionHistoryCsv(history: SessionHistoryEntry[]): string {
  const csvField = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = "Date,Waystones,Average Score,Best Waystone,Best Score";
  const rows = history.map(
    (e) => `${csvField(new Date(e.endedAt).toLocaleString())},${e.count},${e.avg.toFixed(1)},${csvField(e.best.name)},${e.best.score}`,
  );
  return [header, ...rows].join("\r\n");
}
