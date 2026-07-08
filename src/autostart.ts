/** Launch-with-Windows toggle (Settings panel). Unlike every other Settings
 *  row, the on/off state is NOT mirrored in localStorage — the Windows
 *  registry Run key (via tauri-plugin-autostart) is the single source of
 *  truth, read fresh with `isEnabled()` at mount instead of a stored flag,
 *  so the checkbox can never drift from what actually happens at the next
 *  login. */

export async function getAutostartEnabled(): Promise<boolean> {
  if (!("__TAURI_INTERNALS__" in window)) return false; // plain-browser dev
  const { isEnabled } = await import("@tauri-apps/plugin-autostart");
  return isEnabled().catch(() => false);
}

export async function setAutostartEnabled(enabled: boolean): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return; // plain-browser dev: no-op
  const { enable, disable } = await import("@tauri-apps/plugin-autostart");
  await (enabled ? enable() : disable());
}
