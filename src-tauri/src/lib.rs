use std::{env, fs, sync::Mutex, thread, time::Duration};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    webview::Color,
    Manager, WebviewUrl, WebviewWindowBuilder,
};

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .manage(InteractiveRects(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![
            set_interactive_rects,
            log_window_diagnostics,
            log_frontend_report,
            show_window,
            reveal_window,
            simulate_copy,
            hide_window
        ])
        .setup(|app| {
            seed_meta_json(app.handle());

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
