use std::{env, fs, sync::Mutex, thread, time::Duration};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    webview::Color,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Bundled starting point for the user-editable meta.json (cahier des
/// charges §10) — copied into the app config dir on first run only, never
/// overwriting a file the user has since edited.
const DEFAULT_META_JSON: &str = include_str!("../default-meta.json");

/// Logical window size — the single source of truth, also passed to
/// `.inner_size()` at window creation. `reveal_window` re-asserts this
/// explicitly (converted to physical px) rather than nudging off of a
/// relative `inner_size()` read, which was observed to occasionally read
/// back a corrupted size (window collapsed to 16×16) right after a
/// hide()/show() cycle.
const WINDOW_LOGICAL_SIZE: (f64, f64) = (620.0, 416.0);

fn seed_meta_json(app: &tauri::AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("meta.json");
    if !path.exists() {
        let _ = fs::write(&path, DEFAULT_META_JSON);
    }
}

type Rect = (f64, f64, f64, f64);

/// Physical-pixel screen rects of the currently-visible interactive controls
/// (§2: toggle / footer / mod-scroll only), reported by the frontend after
/// every mount, mode morph, and analyze. Click-through is re-enabled for the
/// whole window except when the cursor is inside one of these.
struct InteractiveRects(Mutex<Vec<Rect>>);

#[tauri::command]
fn set_interactive_rects(state: tauri::State<'_, InteractiveRects>, rects: Vec<Rect>) {
    *state.0.lock().unwrap() = rects;
}

/// Defensive recompose nudge against the intermittent WebView2/
/// DirectComposition black-frame race (window reports visible/correctly
/// positioned but paints nothing) — observed on the click-through hover
/// transition, on tray un-hide, and on the Escape/click-away/Ins show-hide
/// cycle added below. A 1px resize-and-back forces WM_SIZE, which forces
/// WebView2 to recompose a fresh frame instead of potentially surfacing a
/// stale/black one.
fn recompose_nudge(window: &tauri::WebviewWindow) {
    if !env_flag("OVERLAY_HOVER_NUDGE", true) {
        return;
    }
    if let Ok(size) = window.inner_size() {
        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(size.width + 1, size.height)));
        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(size.width, size.height)));
    }
}

/// Re-asserts `WINDOW_LOGICAL_SIZE` (converted to physical px for the
/// window's current DPI) and nudges via a 1px resize-and-back — used after
/// a hide()/show() cycle (tray un-hide, Escape/click-away/Ins reveal),
/// where a *relative* nudge off `inner_size()` was observed to occasionally
/// read back a corrupted size (window collapsed to 16×16) rather than the
/// real 620×416. Forcing the known-good absolute size fixes that even if
/// the read-back was already wrong, and the resize itself still forces the
/// WM_SIZE that recomposes a fresh WebView2 frame (the original black-frame
/// motivation for nudging at all).
fn restore_known_size(window: &tauri::WebviewWindow) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let w = (WINDOW_LOGICAL_SIZE.0 * scale).round() as u32;
    let h = (WINDOW_LOGICAL_SIZE.1 * scale).round() as u32;
    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(w + 1, h)));
    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(w, h)));
}

// NOTE: deliberately no nudge here — this is the startup "post-paint
// signal" path, and nudging that early once regressed to an
// invisible-from-the-start window in testing (see the click-through
// thread's `first_check` guard below for the same lesson). Post-hide
// re-reveals use `reveal_window` instead, which nudges safely.
#[tauri::command]
fn show_window(window: tauri::WebviewWindow) -> Result<(), String> {
    println!("[overlay] show_window invoked by frontend (post-paint signal)");
    window.show().map_err(|e| e.to_string())
}

/// Re-reveals the overlay after Escape/click-away/tray-hide — unlike
/// `show_window` (startup-only), this nudges the surface since the black-
/// frame race has also been observed right after un-hiding.
#[tauri::command]
fn reveal_window(window: tauri::WebviewWindow) -> Result<(), String> {
    println!("[overlay] reveal_window invoked by frontend");
    window.show().map_err(|e| e.to_string())?;
    restore_known_size(&window);
    Ok(())
}

/// Simulates Ctrl+C so the frontend can read a fresh clipboard value without
/// requiring the user to copy manually before pressing Ins (cahier des
/// charges §4). Only sends the keystroke — clipboard read stays in JS via
/// tauri-plugin-clipboard-manager, same as before.
#[tauri::command]
fn simulate_copy() -> Result<(), String> {
    use enigo::{Direction::Click, Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| {
        println!("[overlay] simulate_copy: Enigo::new failed: {e}");
        e.to_string()
    })?;
    // Key::Unicode('c') sends a KEYEVENTF_UNICODE WM_CHAR, not a VK_C
    // keydown — most apps' Ctrl+C accelerator (Notepad, the game) listens
    // for the virtual-key event, so a held-Ctrl + Unicode 'c' never
    // registers as the shortcut. Key::C is the actual VK_C keycode, but
    // enigo only defines that variant on Windows — macOS/Linux only have
    // Key::Unicode, which is fine there since Cmd/Ctrl-modified Unicode
    // keys do register as accelerators on those platforms.
    #[cfg(target_os = "windows")]
    let c_key = Key::C;
    #[cfg(not(target_os = "windows"))]
    let c_key = Key::Unicode('c');
    // macOS' copy accelerator is Cmd+C, not Ctrl+C.
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;
    let result = (|| -> Result<(), enigo::InputError> {
        enigo.key(modifier, enigo::Direction::Press)?;
        enigo.key(c_key, Click)?;
        enigo.key(modifier, enigo::Direction::Release)?;
        Ok(())
    })();
    match &result {
        Ok(()) => println!("[overlay] simulate_copy: Ctrl+C sent"),
        Err(e) => println!("[overlay] simulate_copy: key send failed: {e}"),
    }
    result.map_err(|e| e.to_string())
}

/// Settings panel's "Hide" button — sends the overlay to the tray instead of
/// exiting the process. The only way to actually quit is the tray icon's
/// right-click menu (see `run()`), so a stray click here can't kill the
/// overlay mid-session.
#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) -> Result<(), String> {
    println!("[overlay] hide_window invoked by frontend");
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn log_frontend_report(report: String) {
    println!("=== frontend report ===");
    println!("{report}");
    println!("=======================");
}

#[tauri::command]
async fn log_window_diagnostics(window: tauri::WebviewWindow) -> Result<(), String> {
    let label = window.label().to_string();
    let outer_size = window.outer_size().map_err(|e| e.to_string())?;
    let inner_size = window.inner_size().map_err(|e| e.to_string())?;
    let outer_pos = window.outer_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let monitor = window.current_monitor().map_err(|e| e.to_string())?;
    let visible = window.is_visible().map_err(|e| e.to_string())?;
    let focused = window.is_focused().map_err(|e| e.to_string())?;

    println!("=== window diagnostics ===");
    println!("label:            {label}");
    println!("outer_size:       {}x{}", outer_size.width, outer_size.height);
    println!("inner_size:       {}x{}", inner_size.width, inner_size.height);
    println!("outer_position:   ({}, {})", outer_pos.x, outer_pos.y);
    println!("scale_factor:     {scale}");
    if let Some(m) = &monitor {
        println!(
            "current_monitor:  pos=({},{}) size={}x{} scale={}",
            m.position().x,
            m.position().y,
            m.size().width,
            m.size().height,
            m.scale_factor()
        );
    } else {
        println!("current_monitor:  none");
    }
    println!("visible:          {visible}");
    println!("focused:          {focused}");
    println!("=== env matrix ===");
    for key in [
        "OVERLAY_DEBUG_OPAQUE",
        "OVERLAY_TRANSPARENT",
        "OVERLAY_DECORATIONS",
        "OVERLAY_ALWAYS_ON_TOP",
        "OVERLAY_SHADOW",
        "OVERLAY_SKIP_TASKBAR",
        "OVERLAY_CLICK_THROUGH",
    ] {
        println!("{key}: {}", env::var(key).unwrap_or_else(|_| "(unset)".into()));
    }
    println!("==========================");
    Ok(())
}

fn env_flag(key: &str, default: bool) -> bool {
    match env::var(key).as_deref() {
        Ok("0") => false,
        Ok("1") => true,
        _ => default,
    }
}

fn has_cli_flag(flag: &str) -> bool {
    env::args().any(|a| a == flag)
}

// VK_LBUTTON state, polled (not hooked) — same tradeoff as the existing
// cursor-position click-through loop: cheap, no system-wide keyboard/mouse
// hook to fight anti-cheat over, at the cost of ~50ms latency. Click-through
// already means clicks in the game pass straight to it; this just also
// notices that a real click happened out there so the overlay can get out
// of the way (§ cahier des charges: hide on click-away or Escape, reappear
// on Ins).
#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn GetAsyncKeyState(vkey: i32) -> i16;
}

/// Bit 0 of GetAsyncKeyState is "was pressed since the *previous* call to
/// this function" — not just "is down right now". A real click's down+up
/// can both land inside one 50ms poll gap, so checking the instantaneous
/// high bit alone missed clicks in testing; the low bit is exactly the
/// edge-detection this polling loop needs, no `was-it-down-last-tick`
/// bookkeeping required on our side.
#[cfg(target_os = "windows")]
fn left_click_since_last_poll() -> bool {
    const VK_LBUTTON: i32 = 0x01;
    unsafe { (GetAsyncKeyState(VK_LBUTTON) as u16) & 0x0001 != 0 }
}

#[cfg(not(target_os = "windows"))]
fn left_click_since_last_poll() -> bool {
    false // dev-only platforms here never run the real click-through path anyway
}

/// Modifier layer per action, applied to one user-remappable base key
/// (KNOWN_ISSUES #7): base = analyze, Shift+base = toggle, Control+base =
/// compare. The accelerators are registered and handled entirely Rust-side:
/// the JS-side `register()` API of tauri-plugin-global-shortcut proved
/// unreliable on Windows — registration would succeed but the event channel
/// to the webview sometimes never delivered a single keypress until the app
/// was restarted (diagnosed 2026-07-06 from session logs: healthy launches
/// showed hundreds of `state=Pressed` deliveries, broken launches showed
/// zero, with identical successful registrations). Rust-side registration +
/// a standard `app.emit()` rides the same event system every invoke/report
/// in this app already uses, which has never misfired.
/// Escape is deliberately absent — it's a local keydown listener in
/// hotkeys.ts (a global Escape grab swallowed the key OS-wide).
const HOTKEY_ACTIONS: &[(&str, &str)] = &[
    ("", "analyze"),
    ("Shift+", "toggle"),
    ("Control+", "compare"),
];

const DEFAULT_HOTKEY_BASE: &str = "Insert";

/// Keys a global grab must never own: Escape (already a local listener, and
/// grabbing it OS-wide broke the key everywhere — see hotkeys.ts) and
/// editing keys. Printable keys (letters/digits/punctuation/numpad) are
/// rejected separately by `is_printable_key` — a global grab swallows the
/// key OS-wide, which would break typing everywhere, the game's chat
/// included (and Control+C is what `simulate_copy` *sends*: grabbing C
/// would make the overlay swallow its own copy keystroke).
const HOTKEY_BLOCKLIST: &[&str] = &[
    "Escape", "Enter", "NumpadEnter", "Space", "Tab", "Backspace",
];

/// W3C `KeyboardEvent.code` values that produce text — all rejected as
/// hotkey bases (see HOTKEY_BLOCKLIST's rationale). Anything left is
/// F-keys, navigation (Insert/Delete/Home/End/PageUp/PageDown), arrows,
/// and lock/system keys.
fn is_printable_key(base: &str) -> bool {
    if base.len() == 4 && base.starts_with("Key") {
        return true; // KeyA..KeyZ
    }
    if base.len() == 6 && base.starts_with("Digit") {
        return true; // Digit0..Digit9
    }
    if base.starts_with("Numpad") && base != "NumpadEnter" {
        return true; // Numpad0..9 and the printable operators
    }
    matches!(
        base,
        "Comma" | "Period" | "Slash" | "Semicolon" | "Quote" | "BracketLeft" | "BracketRight"
            | "Backslash" | "Backquote" | "Minus" | "Equal" | "IntlBackslash" | "IntlRo" | "IntlYen"
    )
}

/// Current base key — user-remappable via `set_hotkey_base`, persisted in
/// the app config dir (see `hotkey_file`) since registration happens at
/// startup, before the webview (and its localStorage) exists.
struct HotkeyBase(Mutex<String>);

/// The three (accelerator, action) pairs derived from a base key.
fn hotkey_accels(base: &str) -> Vec<(String, &'static str)> {
    HOTKEY_ACTIONS
        .iter()
        .map(|(prefix, action)| (format!("{prefix}{base}"), *action))
        .collect()
}

/// Rejects modifiers/blocklisted keys and anything the shortcut plugin can't
/// parse (the frontend sends raw `KeyboardEvent.code` values — "KeyA",
/// "F9", "Insert", "Numpad5" — which are exactly the W3C `Code` names the
/// plugin's parser accepts).
fn validate_hotkey_base(base: &str) -> Result<(), String> {
    if base.is_empty() || base.contains('+') || base.contains(char::is_whitespace) {
        return Err("touche invalide".into());
    }
    if HOTKEY_BLOCKLIST.iter().any(|b| b.eq_ignore_ascii_case(base)) {
        return Err("touche réservée (Échap, Entrée, chat)".into());
    }
    if is_printable_key(base) {
        return Err("touche de frappe — elle serait avalée partout, chat compris".into());
    }
    for (accel, _) in hotkey_accels(base) {
        if accel.parse::<Shortcut>().is_err() {
            return Err("touche non supportée".into());
        }
    }
    Ok(())
}

fn hotkey_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("hotkey.txt"))
}

fn persist_hotkey_base(app: &tauri::AppHandle, base: &str) {
    let Some(path) = hotkey_file(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Err(e) = fs::write(&path, base) {
        println!("[hotkey] persist failed: {e}");
    }
}

fn load_hotkey_base(app: &tauri::AppHandle) -> String {
    let stored = hotkey_file(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string());
    match stored {
        Some(base) if !base.is_empty() => {
            if validate_hotkey_base(&base).is_ok() {
                base
            } else {
                println!("[hotkey] stored base {base:?} invalid — using {DEFAULT_HOTKEY_BASE}");
                DEFAULT_HOTKEY_BASE.into()
            }
        }
        _ => DEFAULT_HOTKEY_BASE.into(),
    }
}

#[tauri::command]
fn get_hotkey_base(state: tauri::State<'_, HotkeyBase>) -> String {
    state.0.lock().unwrap().clone()
}

/// Remaps the base key: unregisters the old trio, registers the new one,
/// and rolls back to the old trio if any new registration fails (typically
/// a conflict with another app's global shortcut) so the overlay never ends
/// up with no working hotkeys. Persists on success. Errors are
/// user-displayable French (shown in the Settings panel).
#[tauri::command]
fn set_hotkey_base(
    app: tauri::AppHandle,
    state: tauri::State<'_, HotkeyBase>,
    base: String,
) -> Result<String, String> {
    let base = base.trim().to_string();
    validate_hotkey_base(&base)?;
    let old = state.0.lock().unwrap().clone();
    if old == base {
        return Ok(base);
    }
    let gs = app.global_shortcut();
    for (accel, _) in hotkey_accels(&old) {
        let _ = gs.unregister(accel.as_str());
    }
    let mut registered: Vec<String> = Vec::new();
    for (accel, _) in hotkey_accels(&base) {
        match gs.register(accel.as_str()) {
            Ok(()) => registered.push(accel),
            Err(e) => {
                println!("[hotkey] remap to {base} failed at {accel}: {e} — rolling back to {old}");
                for done in &registered {
                    let _ = gs.unregister(done.as_str());
                }
                for (accel, _) in hotkey_accels(&old) {
                    let _ = gs.register(accel.as_str());
                }
                return Err("touche déjà prise par une autre application".into());
            }
        }
    }
    *state.0.lock().unwrap() = base.clone();
    persist_hotkey_base(&app, &base);
    println!("[hotkey] base remapped: {old} -> {base}");
    Ok(base)
}

/// Registers the three accelerators for `base`, retrying failures on a
/// backoff (2s→32s) in a background thread — the common conflict is
/// transient (a previous overlay instance still shutting down during a
/// relaunch).
fn register_hotkeys(app: &tauri::AppHandle, base: &str) {
    const RETRY_DELAYS: [u64; 5] = [2, 4, 8, 16, 32];
    let mut pending: Vec<String> = Vec::new();
    for (accel, _) in hotkey_accels(base) {
        match app.global_shortcut().register(accel.as_str()) {
            Ok(()) => println!("[hotkey] {accel} registered"),
            Err(e) => {
                println!("[hotkey] {accel} FAILED to register (will retry): {e}");
                pending.push(accel);
            }
        }
    }
    if pending.is_empty() {
        return;
    }
    let handle = app.clone();
    thread::spawn(move || {
        for delay in RETRY_DELAYS {
            thread::sleep(Duration::from_secs(delay));
            // A remap (set_hotkey_base) may have landed while waiting —
            // don't resurrect accelerators for a base the user replaced.
            let current = handle.state::<HotkeyBase>().0.lock().unwrap().clone();
            let live: Vec<String> = hotkey_accels(&current).into_iter().map(|(a, _)| a).collect();
            pending.retain(|a| live.contains(a));
            pending.retain(|accel| match handle.global_shortcut().register(accel.as_str()) {
                Ok(()) => {
                    println!("[hotkey] {accel} registered after retry");
                    false
                }
                Err(_) => true,
            });
            if pending.is_empty() {
                return;
            }
        }
        for accel in &pending {
            println!("[hotkey] {accel} PERMANENTLY unavailable — bound by another app");
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    // Compare parsed Shortcuts, not display strings — the
                    // plugin's to_string() normalization isn't a stable
                    // format to match against.
                    let base = app.state::<HotkeyBase>().0.lock().unwrap().clone();
                    let action = hotkey_accels(&base)
                        .into_iter()
                        .find(|(accel, _)| accel.parse::<Shortcut>().is_ok_and(|s| s == *shortcut))
                        .map(|(_, action)| action);
                    match action {
                        Some(action) => {
                            println!("[hotkey] shortcut pressed -> {action}");
                            if let Err(e) = app.emit("overlay://hotkey", action) {
                                println!("[hotkey] emit failed: {e}");
                            }
                        }
                        None => println!("[hotkey] unmatched shortcut fired: {shortcut:?}"),
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        // MacosLauncher::LaunchAgent is ignored on Windows (this app's only
        // real target) but required at compile time by the plugin's API.
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(InteractiveRects(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![
            set_interactive_rects,
            log_window_diagnostics,
            log_frontend_report,
            show_window,
            reveal_window,
            simulate_copy,
            hide_window,
            get_hotkey_base,
            set_hotkey_base
        ])
        .setup(|app| {
            seed_meta_json(app.handle());
            let hotkey_base = load_hotkey_base(app.handle());
            app.manage(HotkeyBase(Mutex::new(hotkey_base.clone())));
            register_hotkeys(app.handle(), &hotkey_base);

            // --debug-opaque-overlay (or OVERLAY_DEBUG_OPAQUE=1 under `tauri dev`):
            // same window geometry/position as the shipped overlay, but opaque,
            // non-click-through, with a big "OVERLAY DEBUG" label — proves the
            // surface paints at all, isolated from every transparency/compositing
            // variable. Every other axis stays independently toggleable via env
            // var for the render-paint investigation.
            let debug_opaque = has_cli_flag("--debug-opaque-overlay") || env_flag("OVERLAY_DEBUG_OPAQUE", false);
            // Independently overridable even in debug mode (bisect: is `transparent`
            // itself the hover-blackening culprit?) — defaults false in debug mode
            // (matching the original "prove paint works" intent) unless set explicitly.
            let transparent = env_flag("OVERLAY_TRANSPARENT", !debug_opaque);
            let decorations = env_flag("OVERLAY_DECORATIONS", false); // frameless in both modes — same geometry
            let always_on_top = env_flag("OVERLAY_ALWAYS_ON_TOP", true);
            let shadow = env_flag("OVERLAY_SHADOW", false);
            let skip_taskbar = env_flag("OVERLAY_SKIP_TASKBAR", true);
            // Independently overridable even in debug mode (bisect: is the runtime
            // set_ignore_cursor_events() toggling itself the hover-blackening culprit?).
            let click_through = env_flag("OVERLAY_CLICK_THROUGH", !debug_opaque);

            let title = if debug_opaque { "Waystone Overlay [DEBUG OPAQUE]" } else { "Waystone Overlay" };

            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title(title)
                .inner_size(WINDOW_LOGICAL_SIZE.0, WINDOW_LOGICAL_SIZE.1)
                .resizable(false)
                .decorations(decorations)
                .transparent(transparent)
                .always_on_top(always_on_top)
                .shadow(shadow)
                .skip_taskbar(skip_taskbar)
                .focused(false)
                .visible(false); // shown explicitly once the frontend confirms a real first paint

            // Fully-transparent windows leave DirectComposition's clear color
            // undefined; on a hover-triggered recomposite (DWM hit-test
            // re-evaluation) that ambiguity is a known trigger for the surface
            // going solid black instead of showing the real frame. Stating the
            // color explicitly removes that ambiguity. Opaque debug builds get
            // an explicit opaque color too, for the same reason.
            if env_flag("OVERLAY_EXPLICIT_BG", true) {
                builder = builder.background_color(if transparent {
                    Color(0, 0, 0, 0)
                } else {
                    Color(26, 26, 46, 255) // matches the debug-opaque #1a1a2e ground
                });
            }

            let win = builder.build()?;

            println!(
                "[overlay] window built: debug_opaque={debug_opaque} transparent={transparent} \
                 decorations={decorations} always_on_top={always_on_top} shadow={shadow} \
                 skip_taskbar={skip_taskbar} click_through={click_through}"
            );

            if click_through {
                win.set_ignore_cursor_events(true)?;

                let handle = win.clone();
                let app_handle = app.handle().clone();
                thread::spawn(move || {
                    let mut interactive = false;
                    let mut first_check = true;
                    loop {
                        let rects = app_handle.state::<InteractiveRects>().0.lock().unwrap().clone();
                        let inside = match handle.cursor_position() {
                            Ok(c) if !rects.is_empty() => rects
                                .iter()
                                .any(|&(x, y, w, h)| c.x >= x && c.y >= y && c.x < x + w && c.y < y + h),
                            // No regions reported yet (early startup): fall back to
                            // whole-window bounds so nothing is un-clickable before
                            // the frontend's first report lands.
                            Ok(c) => match (handle.outer_position(), handle.outer_size()) {
                                (Ok(p), Ok(s)) => {
                                    c.x >= p.x as f64
                                        && c.y >= p.y as f64
                                        && c.x < (p.x + s.width as i32) as f64
                                        && c.y < (p.y + s.height as i32) as f64
                                }
                                _ => interactive,
                            },
                            _ => interactive,
                        };
                        // Skip the nudge (but still sync `interactive`/cursor-events) on
                        // the thread's first observation — if the cursor already happens
                        // to be over the window at startup (e.g. left there from a prior
                        // test), this is establishing initial state, not a real hover
                        // entry, and nudging this early raced with window-show and caused
                        // an "invisible from the start" regression in testing.
                        let is_real_transition = inside != interactive && !first_check;
                        first_check = false;
                        if inside != interactive {
                            interactive = inside;
                            let _ = handle.set_ignore_cursor_events(!inside);
                            if inside && is_real_transition {
                                println!("[overlay] hover-nudge firing (cursor entered window)");
                                recompose_nudge(&handle);
                            }
                        }

                        // Click-away-to-dismiss: a fresh left-click landing outside every
                        // reported interactive rect is, by definition, a click-through
                        // click into the game — hide the overlay so it doesn't linger
                        // over gameplay until the player deliberately re-checks with Ins
                        // (see reveal_window / hotkeys.ts's Insert handler).
                        if left_click_since_last_poll() && !inside {
                            let _ = handle.hide();
                        }

                        thread::sleep(Duration::from_millis(50));
                    }
                });
            } else {
                println!("[overlay] click-through disabled — window is focusable/interactive");
            }

            // System-tray icon: the only way to fully quit. The window itself
            // has no decorations/close box and is skip_taskbar, so without
            // this a stray Settings-panel click was the sole exit — now that
            // button just hides the window (see `hide_window`), and this menu
            // is what actually ends the process.
            let show_item = MenuItem::with_id(app, "show", "Afficher / Masquer", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let tray_win = win.clone();
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&tray_menu)
                .show_menu_on_left_click(true)
                .tooltip("Waystone Overlay")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "quit" => {
                        println!("[overlay] quit requested from tray menu");
                        app.exit(0);
                    }
                    "show" => {
                        println!("[overlay] show requested from tray menu");
                        let _ = tray_win.show();
                        let _ = tray_win.set_focus();
                        restore_known_size(&tray_win);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running waystone overlay");
}
