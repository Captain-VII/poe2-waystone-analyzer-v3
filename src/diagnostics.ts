/** Render-paint investigation diagnostics. Logs only — no screen capture.
 *  Everything here writes to devtools console / stdout so state is provable
 *  without a screenshot. */

/** Builds a diagnostic report and ships it to the Rust side via invoke(), since
 *  WebView2 console output is not forwarded to the terminal. This is the
 *  primary evidence channel for the render-paint investigation. */
async function buildReport(): Promise<Record<string, unknown>> {
  const app = document.getElementById("app");
  const overlay = document.querySelector(".overlay");
  const panel = document.querySelector(".panel");
  const bodyStyle = getComputedStyle(document.body);
  const htmlStyle = getComputedStyle(document.documentElement);

  const report: Record<string, unknown> = {
    url: location.href,
    readyState: document.readyState,
    errors: capturedErrors,
    htmlSize: [document.documentElement.clientWidth, document.documentElement.clientHeight],
    bodySize: [document.body.clientWidth, document.body.clientHeight],
    bodyBackground: bodyStyle.backgroundColor,
    bodyOpacity: bodyStyle.opacity,
    htmlBackground: htmlStyle.backgroundColor,
    appFound: !!app,
    appChildCount: app?.childElementCount ?? -1,
    appInnerHTMLLength: app?.innerHTML.length ?? -1,
    overlayFound: !!overlay,
    panelFound: !!panel,
  };

  if (panel) {
    const r = panel.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    report.panelRect = { x: r.x, y: r.y, width: r.width, height: r.height };
    report.panelComputed = {
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      transform: cs.transform,
      backgroundImage: cs.backgroundImage.slice(0, 80),
      backgroundColor: cs.backgroundColor,
      position: cs.position,
      zIndex: cs.zIndex,
    };
  }
  if (overlay) {
    const r = (overlay as HTMLElement).getBoundingClientRect();
    report.overlayRect = { x: r.x, y: r.y, width: r.width, height: r.height };
    report.overlayComputed = { position: getComputedStyle(overlay).position };
  }

  const stylesheets = Array.from(document.styleSheets).map((s) => {
    try {
      return { href: s.href, ruleCount: s.cssRules.length };
    } catch {
      return { href: s.href, ruleCount: "blocked (cross-origin)" };
    }
  });
  report.stylesheets = stylesheets;

  return report;
}

const capturedErrors: string[] = [];
window.addEventListener("error", (e) => {
  capturedErrors.push(`${e.message} @ ${e.filename}:${e.lineno}`);
});
// A denied Tauri permission rejects a promise, not a synchronous throw —
// without this, that failure would be invisible to every report above.
window.addEventListener("unhandledrejection", (e) => {
  capturedErrors.push(`unhandledrejection: ${e.reason}`);
});

export async function runDiagnostics(): Promise<{ debugOpaque: boolean }> {
  if (!("__TAURI_INTERNALS__" in window)) {
    console.log("[diag] not running under Tauri (plain browser) — skipping window/invoke checks");
    return { debugOpaque: false };
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { invoke } = await import("@tauri-apps/api/core");
  const win = getCurrentWindow();
  const title = await win.title();

  const report = await buildReport();
  await invoke("log_frontend_report", { report: JSON.stringify(report, null, 2) }).catch((e) =>
    capturedErrors.push(`log_frontend_report failed: ${e}`),
  );
  await invoke("log_window_diagnostics").catch((e) => capturedErrors.push(`log_window_diagnostics failed: ${e}`));

  return { debugOpaque: title.includes("DEBUG") };
}

/** Applied only when Rust built the debug-opaque window (title carries
 *  "DEBUG"). Same window geometry/position as the shipped overlay — opaque
 *  dark background, giant "OVERLAY DEBUG" label, bright 2px border — so
 *  "does the surface paint at all, at the right place" is answerable without
 *  touching a single transparency/compositing setting. */
export function applyDebugOpaqueOverride(): void {
  const bg = "#1a1a2e"; // dark, but visibly distinct from the app's near-black panel tokens
  const accent = "#39ff88"; // bright lime — unmistakable against the dark ground
  document.documentElement.style.background = bg;
  document.body.style.background = bg;
  document.body.style.boxSizing = "border-box";
  document.body.style.border = `2px solid ${accent}`;

  const banner = document.createElement("div");
  banner.textContent = "OVERLAY DEBUG";
  banner.style.cssText = `
    position: fixed; inset: 0; z-index: 999999;
    display: flex; align-items: center; justify-content: center;
    color: ${accent}; font: 900 40px system-ui;
    letter-spacing: 4px; pointer-events: none;
    text-shadow: 0 0 12px rgba(57, 255, 136, 0.5);
  `;
  document.body.appendChild(banner);
  console.log("[diag] debug-opaque visual override applied");
}

/** Fires the window's real show() only after two rAF ticks confirm a frame
 *  has actually been composited — works around the Tauri/WebView2 issue where
 *  a window shown via `visible(true)` on the builder can freeze on a blank
 *  first frame if shown before the compositor attaches. */
export async function showWhenPainted(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  // WKWebView (macOS) suspends requestAnimationFrame entirely while the
  // window is still hidden, so the double-rAF paint confirmation below
  // never resolves there — the race against a fixed timeout keeps the
  // Windows/WebView2 double-rAF behavior (which does confirm a real
  // composited frame) while still showing the window on platforms where
  // rAF never fires pre-visibility.
  await Promise.race([
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, 300)),
  ]);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("show_window").catch((e) => capturedErrors.push(`show_window failed: ${e}`));
}

/** Lightweight per-Ins checkpoint (unlike sendReport's full DOM dump) —
 *  confirms whether a real clipboard analysis was applied vs. left
 *  unchanged. See docs/release-checklist.md §3. */
export async function logAnalyzeAttempt(info: {
  hadClipboardText: boolean;
  applied: { score: number; tierClass: string; name: string } | null;
  failure?: "clipboard" | "not-waystone" | null;
  clipPreview?: string | null;
}): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("log_frontend_report", { report: JSON.stringify({ tag: "analyze-attempt", ...info }, null, 2) }).catch(
    (e) => capturedErrors.push(`logAnalyzeAttempt failed: ${e}`),
  );
}

/** Re-sends the full report tagged with a phase label (e.g. "post-placement"),
 *  so before/after snapshots are distinguishable in the terminal log. */
export async function sendReport(tag: string): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const report = await buildReport();
  (report as Record<string, unknown>).tag = tag;
  await invoke("log_frontend_report", { report: JSON.stringify(report, null, 2) }).catch((e) =>
    capturedErrors.push(`log_frontend_report(${tag}) failed: ${e}`),
  );
}
