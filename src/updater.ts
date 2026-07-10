/** Auto-update via tauri-plugin-updater against the rolling `updater`
 *  release's latest.json on GitHub. Check is silent (startup + on demand
 *  from Settings); install only ever runs on an explicit user click —
 *  never automatically under a running game. No-op in plain-browser dev. */

export interface UpdateInfo {
  version: string;
  notes?: string;
}

// The Update handle from the last successful check, kept for install.
let pending: import("@tauri-apps/plugin-updater").Update | null = null;

/** Never throws. null = no update available / not Tauri / check failed
 *  (offline, endpoint missing…) — callers can't tell those apart and
 *  shouldn't: the overlay must behave identically in all three cases. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    pending = update;
    return { version: update.version, notes: update.body ?? undefined };
  } catch {
    return null;
  }
}

/** Rejects on failure so the Settings row can show an error and reset.
 *  onProgress receives 0-100, or null when the total size is unknown. */
export async function installUpdate(
  onProgress?: (pct: number | null) => void,
): Promise<void> {
  if (!pending) throw new Error("no pending update — call checkForUpdate first");
  let total = 0;
  let got = 0;
  await pending.downloadAndInstall((ev) => {
    if (ev.event === "Started") {
      total = ev.data.contentLength ?? 0;
    } else if (ev.event === "Progress") {
      got += ev.data.chunkLength;
      onProgress?.(total > 0 ? Math.round((got / total) * 100) : null);
    } else if (ev.event === "Finished") {
      onProgress?.(100);
    }
  });
  // On Windows the passive NSIS updater exits and relaunches the app by
  // itself; relaunch() is the documented tail and a harmless fallback if
  // that ever changes.
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
