/** OS notification for Legendaire waystones (cahier des charges §16 Phase
 *  4 "Notifications / alertes pour waystones legendaires") — the overlay
 *  itself is easy to miss mid-combat, so a Legendaire find also gets a
 *  native toast. No-op in plain-browser dev (no Tauri). */
export async function notifyLegendaryWaystone(name: string, score: number): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;
    sendNotification({
      title: "Legendaire ✦",
      body: `${name} — Juice Score ${score}/100`,
    });
  } catch {
    // Notifications are a nice-to-have alert, never block analysis on this.
  }
}
