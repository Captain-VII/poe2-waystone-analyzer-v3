/** Tauri-side IO for the user-editable meta.json (cahier des charges §10):
 *  reads/writes $APPCONFIG/meta.json and (re)activates the merged mechanic +
 *  tablet tables. All parse/merge/diff logic is pure and lives in
 *  meta-schema.ts — this file only owns the plugin-fs calls and the
 *  setActive* application. Never throws on load: any missing file, bad
 *  JSON, or unknown mechanic key/stat name silently degrades to the
 *  hardcoded defaults, matching every other analyzer module's contract. */

import { MECHANICS, setActiveMechanics } from "./mechanics";
import { DEFAULT_TABLETS, setActiveTablets } from "./tablets";
import {
  parseMetaFile,
  mergeMetaConfig,
  serializeMetaFile,
  type RawMetaFile,
} from "./meta-schema";

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function applyMerged(parsed: RawMetaFile | null): void {
  const { mechanics, tablets } = mergeMetaConfig(parsed);
  setActiveMechanics(mechanics);
  setActiveTablets(tablets);
}

/** Reads meta.json (if running under Tauri) and activates the merged
 *  mechanic + tablet tables for subsequent analyses. Safe to call multiple
 *  times (e.g. re-load on demand) — always falls back to the bundled
 *  defaults on failure. */
export async function loadMetaConfig(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { readTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    const text = await readTextFile("meta.json", { baseDir: BaseDirectory.AppConfig });
    applyMerged(parseMetaFile(text));
  } catch {
    setActiveMechanics(MECHANICS);
    setActiveTablets(DEFAULT_TABLETS);
  }
}

/** Reads the raw file for the in-app editor. `corrupt` means the file
 *  exists but doesn't parse as a JSON object — the editor must warn that
 *  saving will rewrite it (hand-written content in a broken file can't be
 *  preserved through a parse failure). Absent file → {raw:null,
 *  corrupt:false}: a perfectly normal pre-first-save state. */
export async function readRawMetaFile(): Promise<{ raw: RawMetaFile | null; corrupt: boolean }> {
  if (!isTauri()) return { raw: null, corrupt: false };
  let text: string;
  try {
    const { readTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    text = await readTextFile("meta.json", { baseDir: BaseDirectory.AppConfig });
  } catch {
    return { raw: null, corrupt: false }; // absent (or unreadable) — treat as no overrides yet
  }
  const raw = parseMetaFile(text);
  return { raw, corrupt: raw === null };
}

/** Writes `file` then hot-reloads the active tables from what was written
 *  (no disk re-read needed — `file` IS the new state). Ordering matters:
 *  the setActive* application only happens after writeTextFile resolves, so
 *  a failed write leaves the in-memory state untouched and the error
 *  propagates to the editor UI. */
export async function saveMetaFile(file: RawMetaFile): Promise<void> {
  const { writeTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  await writeTextFile("meta.json", serializeMetaFile(file), { baseDir: BaseDirectory.AppConfig });
  applyMerged(file);
}

/** "Rétablir les défauts": writes an empty object rather than deleting the
 *  file — deletion would need an extra fs permission AND lib.rs's
 *  seed_meta_json would re-seed the bundled example on next launch. An
 *  existing `{}` merges to pure defaults and blocks the re-seed. */
export async function resetMetaFile(): Promise<void> {
  await saveMetaFile({});
}
