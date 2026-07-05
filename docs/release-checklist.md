# Release checklist

Run through this before shipping any build to someone else. Check off each
item live — don't assume a previous release's pass still holds.

## 1. Version

- [ ] `package.json`'s `"version"` and `src-tauri/tauri.conf.json`'s
      `"version"` match each other.
- [ ] Version was actually bumped from the last shipped build (not a rebuild
      of the same version number).

## 2. Build validation

Run each of these from a clean shell and confirm it exits 0:

```bash
npm run build            # tsc + vite build (frontend type-check)
npm run verify-adapter    # scoring/parsing contract tests against real sample data
cargo check               # (from src-tauri/) Rust type-check
npm run tauri build       # full release build + NSIS installer
```

- [ ] `npm run build` — no TypeScript errors.
- [ ] `npm run verify-adapter` — prints `ALL CHECKS PASSED`.
- [ ] `cargo check` — no errors (warnings OK, read them anyway).
- [ ] `npm run tauri build` — completes and produces
      `src-tauri/target/release/bundle/nsis/waystone-overlay_<version>_x64-setup.exe`.

## 3. Release binary smoke test

Launch `src-tauri/target/release/waystone-overlay.exe` directly (not `tauri
dev` — that's a different code path: dev server vs. bundled assets).

- [ ] Window appears without crashing (accept that per
      [KNOWN_ISSUES.md #1](../KNOWN_ISSUES.md), this may need one retry).
- [ ] It's anchored top-right with the expected safe-zone padding.
- [ ] **Ins** with a real Waystone on the clipboard updates the score/tier/
      verdict/modifiers to match what you copied — not mock/stale data.
      **Gotcha if scripting this test:** simulating the Insert keypress
      (e.g. `SendKeys`) while a terminal has focus can make the terminal's
      own key handling clobber the clipboard *before* the global hotkey
      fires, making it look like analysis silently failed. Focus a neutral
      window (Notepad, or the game itself) first, *then* send Insert.
- [ ] **Ins** with clipboard content that is *not* a Waystone leaves the
      display unchanged (no crash, no blank state).
- [ ] **Shift+Ins** toggles Compact ⇄ Full with the expected morph animation
      and micro-shift.
- [ ] Click-through: clicking through the panel's background reaches
      whatever's behind it; clicking the toggle button, the footer button
      (Compact), and the modifier list (Full) does not.
- [ ] The dev-only tier-cycling badge click does **nothing** in this build
      (confirms the `import.meta.env.DEV` gate actually stripped it).

## 4. Installer smoke test

- [ ] Run the NSIS installer end-to-end: license/progress screens appear,
      install completes, Start Menu shortcut is created.
- [ ] Launch from the Start Menu shortcut — same checks as §3.
- [ ] Uninstall via **Settings → Apps** — the app and its shortcut are fully
      removed.

## 5. Acceptance checklist (spec §13)

Full ten-item walkthrough lives in
[`docs/implementation-plan.md`](implementation-plan.md) under M6 — re-confirm
nothing has regressed since that pass, particularly:

- [ ] Overlay opens in the last persisted mode, no layout flash.
- [ ] All five tier states (Trash/Low/Good/S+/God) render distinctly, God
      halo stays inside the panel + 12px bleed.
- [ ] Reduced motion (OS preference, and `overlay.reduceEffects` in
      localStorage) kills animations but never hides tier colors, badges, or
      warnings.

## 6. Docs

- [ ] [`README.md`](../README.md)'s usage/shortcuts section still matches
      actual behavior.
- [ ] [`KNOWN_ISSUES.md`](../KNOWN_ISSUES.md) reflects current reality — add
      anything newly discovered, remove anything actually fixed this release.
- [ ] `docs/implementation-plan.md` has an entry for whatever changed this
      release (new milestone work, not just bug fixes).

## 7. Repo hygiene

- [ ] `git status` is clean except intended changes — no stray scratch
      files, no debug env-var leftovers in tracked config.
- [ ] No `console.log`/`println!` added this release that would leak
      anything sensitive (clipboard contents, file paths) — the existing
      diagnostic logging is fine, it's local-only and non-sensitive.
- [ ] `src-tauri/target/` and `dist/` are not accidentally tracked.
