/** Patch notes ("Quoi de neuf"). The repo's CHANGELOG.md is bundled into
 *  the app at build time (Vite ?raw import) — works offline, no request.
 *  Auto-shown once when the running version differs from the last version
 *  the user saw (i.e. right after an update); re-readable any time from
 *  the Réglages row. */

import changelogRaw from "../CHANGELOG.md?raw";

export interface ChangelogSection {
  version: string;
  bullets: string[];
}

/** Parses `## X.Y.Z` sections with `- bullet` lines, newest first (file
 *  order). The intro text before the first section is dropped. */
export function parseChangelog(raw: string = changelogRaw): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { version: heading[1]!, bullets: [] };
      sections.push(current);
      continue;
    }
    const bullet = line.match(/^-\s+(.+?)\s*$/);
    if (bullet && current) current.bullets.push(bullet[1]!);
  }
  return sections;
}

const LAST_SEEN_KEY = "changelog.lastSeenVersion";

/** True exactly once per version change: the first launch after an update
 *  (or a fresh install, where showing "what's new" is also fine). Marking
 *  seen is separate (markChangelogSeen) so a crash before the panel renders
 *  doesn't swallow the notes forever. */
export function shouldShowChangelog(currentVersion: string): boolean {
  try {
    return localStorage.getItem(LAST_SEEN_KEY) !== currentVersion;
  } catch {
    return false;
  }
}

export function markChangelogSeen(currentVersion: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, currentVersion);
  } catch {
    // localStorage unavailable — the panel may show again next launch,
    // which is harmless.
  }
}
