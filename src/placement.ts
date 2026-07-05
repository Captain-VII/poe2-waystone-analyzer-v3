/** Top-right anchoring per docs/overlay-ui-spec.md §2.
 *  The window carries PANEL_BLEED logical px of transparent margin around the
 *  panel (ornament/glow overflow), so the safe-zone pad applies to the panel
 *  edge, not the window edge. */

import type { Mode, EffectiveMode } from "./settings";

const PANEL_BLEED = 12;

/** §2 footprints. Full adds 16px clearance for its up-left micro-shift. */
const COMPACT_FOOTPRINT = { w: 292, h: 392 };
const FULL_FOOTPRINT = { w: 580 + 16, h: 332 + 16 };

/** §2 fallback cascade: Full fits (with micro-shift)? → Full. Else Compact
 *  fits? → force Compact. Else → Mini Compact. Never returns "full" unless
 *  `intended` asked for it — Mini/forced-Compact don't get promoted back to
 *  Full on their own; the caller keeps `intendedMode` for that restore. */
export async function computeEffectiveMode(intended: Mode): Promise<EffectiveMode> {
  if (!("__TAURI_INTERNALS__" in window)) return intended; // plain-browser dev
  const { currentMonitor } = await import("@tauri-apps/api/window");
  const mon = await currentMonitor();
  if (!mon) return intended;

  const scale = mon.scaleFactor;
  const monW = mon.size.width / scale;
  const monH = mon.size.height / scale;
  const pad = monW < 1600 || monH < 900 ? 14 : 20;
  const availW = monW - pad * 2;
  const availH = monH - pad * 2;
  const fits = (fp: { w: number; h: number }) => availW >= fp.w && availH >= fp.h;

  if (intended === "full" && fits(FULL_FOOTPRINT)) return "full";
  if (fits(COMPACT_FOOTPRINT)) return "compact";
  return "mini";
}

// Set around our own setPosition() calls so the resulting onMoved() firing
// (placeTopRight moving the window itself) isn't mistaken for an external
// display change and doesn't re-trigger the display watch on itself.
let repositioning = false;

export async function placeTopRight(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return; // plain-browser vite dev
  const { getCurrentWindow, currentMonitor, LogicalPosition } = await import(
    "@tauri-apps/api/window"
  );
  const win = getCurrentWindow();
  const mon = await currentMonitor();
  if (!mon) return;

  const scale = mon.scaleFactor;
  const monX = mon.position.x / scale;
  const monY = mon.position.y / scale;
  const monW = mon.size.width / scale;
  const monH = mon.size.height / scale;
  const pad = monW < 1600 || monH < 900 ? 14 : 20;

  const size = await win.outerSize();
  const winW = size.width / scale;
  const winH = size.height / scale;

  let x = Math.round(monX + monW - winW - (pad - PANEL_BLEED));
  let y = Math.round(monY + (pad - PANEL_BLEED));

  // §2 clamp: no edge may ever leave the screen, whatever the pad math above
  // produced (e.g. a monitor smaller than the window itself).
  x = Math.min(Math.max(x, monX), monX + monW - winW);
  y = Math.min(Math.max(y, monY), monY + monH - winH);

  repositioning = true;
  try {
    await win.setPosition(new LogicalPosition(x, y));
  } finally {
    // Give the resulting onMoved() event a tick to arrive before re-arming.
    setTimeout(() => (repositioning = false), 250);
  }
}

interface MonitorSnapshot {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

async function snapshotMonitor(): Promise<MonitorSnapshot | null> {
  const { currentMonitor } = await import("@tauri-apps/api/window");
  const mon = await currentMonitor();
  if (!mon) return null;
  return { x: mon.position.x, y: mon.position.y, w: mon.size.width, h: mon.size.height, scale: mon.scaleFactor };
}

function sameMonitor(a: MonitorSnapshot | null, b: MonitorSnapshot | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.scale === b.scale;
}

/** §2/M1: re-runs `onChange` whenever the window's display geometry, DPI
 *  scale factor, or usable monitor space actually changes — resolution
 *  change, monitor add/remove/rearrange, moving the window to a
 *  different-DPI display, etc. Combines Tauri's native `onScaleChanged`/
 *  `onMoved`/`onResized` events (fire promptly, but don't cover every OS
 *  display-reconfiguration case) with a slow poll (every 3s) comparing a
 *  monitor snapshot, as a robust fallback that catches whatever the native
 *  events miss — cheap, since it's one IPC call every few seconds.
 *  No-ops in plain-browser dev. Returns a stop function. */
export async function watchDisplayChanges(onChange: () => void): Promise<() => void> {
  if (!("__TAURI_INTERNALS__" in window)) return () => {};

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();

  let last = await snapshotMonitor();

  async function recheck(): Promise<void> {
    if (repositioning) return; // our own placeTopRight() move, not an external change
    const current = await snapshotMonitor();
    if (!sameMonitor(last, current)) {
      last = current;
      onChange();
    }
  }

  const unlistenScale = await win.onScaleChanged(() => void recheck());
  const unlistenMoved = await win.onMoved(() => void recheck());
  const unlistenResized = await win.onResized(() => void recheck());

  const interval = setInterval(() => void recheck(), 3000);

  return () => {
    unlistenScale();
    unlistenMoved();
    unlistenResized();
    clearInterval(interval);
  };
}
