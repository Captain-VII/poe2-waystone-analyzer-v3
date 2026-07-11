/** Global hotkeys — docs/overlay-ui-spec.md §8, cahier des charges §12
 *  ("Le joueur peut basculer entre les modes via un raccourci clavier").
 *
 *  Registration and OS-level handling live entirely in Rust
 *  (src-tauri/src/lib.rs's HOTKEYS/register_hotkeys): the JS-side
 *  `register()` API of tauri-plugin-global-shortcut proved unreliable on
 *  Windows — registration succeeded but the plugin's event channel to the
 *  webview sometimes never delivered a single keypress until the app was
 *  restarted (diagnosed 2026-07-06 from session logs). The frontend only
 *  listens for the Rust handler's `overlay://hotkey` emits, which ride the
 *  same Tauri event system every invoke/report here already uses. */

// No physical Mac keyboard (built-in or Magic Keyboard) has an Insert key —
// F9 stands in for it, but only in the plain-browser dev fallback below;
// the Rust-side registration is Windows-targeted (Insert exists there).
const isMac = navigator.platform.startsWith("Mac") || navigator.userAgent.includes("Mac OS");

export const DEFAULT_HOTKEY_BASE = "Insert";

/** Short display label for a stored base key — bases are raw
 *  `KeyboardEvent.code` values validated Rust-side ("Insert", "KeyA",
 *  "F9", "Numpad5"), so this strips the W3C code prefixes for display. */
export function hotkeyLabel(base: string): string {
  if (base === "Insert") return "Ins";
  if (base === "PageUp") return "PgUp";
  if (base === "PageDown") return "PgDn";
  if (base === "Delete") return "Del";
  if (/^Key[A-Z]$/.test(base)) return base.slice(3);
  if (/^Digit[0-9]$/.test(base)) return base.slice(5);
  if (base.startsWith("Numpad")) return `Num ${base.slice(6)}`;
  return base;
}

/** Maps a captured keydown to a candidate base key, or null for a bare
 *  modifier press (capture should keep listening). Modifier *state* is
 *  deliberately ignored: the Shift/Ctrl layers are reserved for
 *  toggle/compare, so only the unmodified base is remappable. */
export function keyEventToBase(e: KeyboardEvent): string | null {
  if (!e.code || /^(Shift|Control|Alt|Meta)/.test(e.code)) return null;
  return e.code;
}

export async function getHotkeyBase(): Promise<string> {
  if (!("__TAURI_INTERNALS__" in window)) return DEFAULT_HOTKEY_BASE;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("get_hotkey_base").catch(() => DEFAULT_HOTKEY_BASE);
}

/** Resolves with the normalized stored base; rejects with a
 *  user-displayable message (Rust returns French error strings —
 *  reserved key, unparseable key, or registration conflict). */
export async function setHotkeyBase(base: string): Promise<string> {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error("unavailable outside the overlay");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("set_hotkey_base", { base });
}

export async function registerHotkeys(
  onAnalyze: () => void,
  onToggle: () => void,
  onToggleCompare: () => void,
  onHide: () => void,
): Promise<void> {
  // Escape is a local listener in BOTH paths, never a global shortcut: a
  // global Escape grab swallows the key OS-wide on Windows (confirmed in
  // real use 2026-07-06 — Escape stopped working in the game and every
  // other app while the overlay ran). Locally it only fires when the
  // overlay window itself has focus — exactly the one case where
  // "Escape = hide the overlay" makes sense.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") onHide();
  });

  if (!("__TAURI_INTERNALS__" in window)) {
    // plain-browser vite dev: local key handling stands in for global shortcuts
    window.addEventListener("keydown", (e) => {
      const isAnalyze = e.key === "Insert" || (isMac && e.key === "F9");
      if (!isAnalyze) return;
      e.preventDefault();
      if (e.ctrlKey) onToggleCompare();
      else if (e.shiftKey) onToggle();
      else onAnalyze();
    });
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  let firstDelivery = true;
  await listen<string>("overlay://hotkey", (event) => {
    if (firstDelivery) {
      firstDelivery = false;
      // Diagnostic breadcrumb: proves Rust→JS hotkey delivery is alive this
      // session (the exact thing that silently died with the old JS-side
      // registration path).
      void invoke("log_frontend_report", {
        report: `[hotkey debug] first delivery OK (${event.payload})`,
      }).catch(() => {});
    }
    switch (event.payload) {
      case "analyze":
        onAnalyze();
        break;
      case "toggle":
        onToggle();
        break;
      case "compare":
        onToggleCompare();
        break;
      default:
        // Unknown action string — Rust and this switch drifted; log, don't throw.
        void invoke("log_frontend_report", {
          report: `[hotkey debug] unknown action: ${event.payload}`,
        }).catch(() => {});
    }
  });
}
