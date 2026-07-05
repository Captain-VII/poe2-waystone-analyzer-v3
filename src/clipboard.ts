/** Simulates Ctrl+C (via the Rust `simulate_copy` command) then reads the OS
 *  clipboard, so the player only needs to hover the item and press Ins —
 *  no manual copy first (cahier des charges §4). Returns null in
 *  plain-browser dev (no Tauri) or on any read failure — callers fall back
 *  to mock data in that case, never throw.
 *
 *  `simulateCopy` defaults to true (a real Ins press) but MUST be false for
 *  any automatic/non-user-triggered call (e.g. the initial paint on
 *  startup) — the Ctrl+C keystroke goes to whatever window currently has
 *  OS focus, which at startup can be a dev terminal instead of the game.
 *  A stray Ctrl+C delivered to a console is interpreted as SIGINT and kills
 *  it (confirmed: this crashed `tauri dev` with STATUS_CONTROL_C_EXIT). */
export async function readClipboardText(simulateCopy = true): Promise<string | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  try {
    const { readText, writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    // §4 step 1/8: preserve whatever the player had copied before Ins, so
    // simulating our own Ctrl+C doesn't clobber it for good.
    const previous = simulateCopy ? await readText().catch(() => null) : null;

    if (simulateCopy) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("simulate_copy").catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const text = await readText();

    if (simulateCopy && previous !== null && previous !== text) {
      await writeText(previous).catch(() => {});
    }

    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}
