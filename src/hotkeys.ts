/** Global hotkeys — docs/overlay-ui-spec.md §8, cahier des charges §12
 *  ("Le joueur peut basculer entre les modes via un raccourci clavier").
 *  Registered OS-wide (the game holds focus, not the overlay). */

// No physical Mac keyboard (built-in or Magic Keyboard) has an Insert key —
// registering the "Insert"-based accelerators below is harmless there (they
// just can never fire), but leaves the app with no working hotkey at all for
// local dev/testing on this machine. Dev-convenience only: real target is
// Windows, where Insert exists and this block is inert.
const isMac = navigator.platform.startsWith("Mac") || navigator.userAgent.includes("Mac OS");

export async function registerHotkeys(
  onAnalyze: () => void,
  onToggle: () => void,
  onToggleCompare: () => void,
  onHide: () => void,
): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    // plain-browser vite dev: local key handling stands in for global shortcuts
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        onHide();
        return;
      }
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
  const dbg = (accel: string, state: string) =>
    void invoke("log_frontend_report", { report: `[hotkey debug] ${accel} state=${state}` }).catch(() => {});

  const { register } = await import("@tauri-apps/plugin-global-shortcut");
  // Each binding is registered independently — another app (RTSS, a
  // trade-overlay tool, etc.) can already own a given accelerator, and
  // `register()` throws in that case. Without isolating each call, one
  // conflicting binding used to abort every registration after it in the
  // sequence (confirmed: this is exactly how "Ctrl+Insert" vs
  // "Control+Insert" silently killed the rest of registration before). A
  // failure here is logged, not thrown, so the remaining bindings still
  // get a chance.
  //
  // On failure, retries continue in the background (2s/4s/8s/16s/32s):
  // the most common real-world conflict is *transient* — a previous
  // overlay instance still shutting down and holding the accelerator for
  // a moment during a relaunch (reported 2026-07-06: Insert dead at
  // startup until a manual restart). The first attempt is awaited so the
  // happy path is unchanged; retries never block init().
  const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 32000];
  async function tryRegister(accel: string, handler: (state: string) => void): Promise<void> {
    const attempt = () =>
      register(accel, (e) => {
        dbg(accel, e.state);
        if (e.state === "Pressed") handler(e.state);
      });
    try {
      await attempt();
      return;
    } catch (err) {
      console.warn(`[hotkeys] failed to register "${accel}" — retrying in background`, err);
      void invoke("log_frontend_report", {
        report: `[hotkey debug] FAILED to register ${accel} (will retry): ${String(err)}`,
      }).catch(() => {});
    }
    void (async () => {
      for (const delay of RETRY_DELAYS_MS) {
        await new Promise((r) => setTimeout(r, delay));
        try {
          await attempt();
          void invoke("log_frontend_report", {
            report: `[hotkey debug] ${accel} registered after retry`,
          }).catch(() => {});
          return;
        } catch {
          // still held elsewhere — next backoff step
        }
      }
      console.warn(`[hotkeys] "${accel}" permanently unavailable — bound by another app`);
      void invoke("log_frontend_report", {
        report: `[hotkey debug] ${accel} PERMANENTLY unavailable after ${RETRY_DELAYS_MS.length} retries`,
      }).catch(() => {});
    })();
  }

  await tryRegister("Shift+Insert", () => onToggle());
  // "Control", not "Ctrl" — the plugin's accelerator parser doesn't accept
  // the abbreviated form (confirmed: "Ctrl+Insert" silently failed to
  // register).
  await tryRegister("Control+Insert", () => onToggleCompare());
  await tryRegister("Insert", () => onAnalyze());
  // Escape is deliberately NOT a global shortcut: on Windows,
  // RegisterHotKey-style registration DOES swallow the keystroke system-wide
  // (confirmed in real use 2026-07-06 — Escape stopped working in the game
  // and every other app while the overlay ran; the previous comment here
  // claiming otherwise was wrong). A local keydown listener only fires when
  // the overlay window itself has focus — exactly the one case where
  // "Escape = hide the overlay" makes sense — and costs every other app
  // nothing.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") onHide();
  });

  if (isMac) {
    // Dev-only aliases so hotkeys are testable on a Mac keyboard without an
    // external Insert-capable one. F9 is free on macOS by default (Mission
    // Control uses F10/F11/F12); if a user's system remaps it, that's a
    // System Settings > Keyboard Shortcuts toggle, not an app bug.
    await tryRegister("Shift+F9", () => onToggle());
    await tryRegister("Control+F9", () => onToggleCompare());
    await tryRegister("F9", () => onAnalyze());
  }
}
