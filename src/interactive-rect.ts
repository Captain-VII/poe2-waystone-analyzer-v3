/** Reports the currently-visible interactive controls' physical-pixel screen
 *  rects to the Rust side, which gates click-through on them (§2: toggle /
 *  footer / mod-scroll only — everything else stays click-through even while
 *  hovered). Call after placement and after every mode morph settles. */

export async function reportInteractiveRegions(els: HTMLElement[]): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { invoke } = await import("@tauri-apps/api/core");

  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const pos = await win.outerPosition();

  const rects = els.map((el) => {
    const r = el.getBoundingClientRect();
    return [pos.x + r.left * scale, pos.y + r.top * scale, r.width * scale, r.height * scale];
  });

  await invoke("set_interactive_rects", { rects });
}
