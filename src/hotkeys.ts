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
