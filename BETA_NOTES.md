# Beta notes — v0.2.0-beta.1

Thanks for testing. This is a restricted beta, not a public release — please
don't redistribute the installer further without asking first.

## What to expect

Everything in the [README](README.md) works as described: hover a Waystone,
press **Ins**, get a Juice Score + verdict + tablet recommendation. Settings,
hotkey remapping, Compare mode, and autostart are all functional.

## Known limitations — read before reporting a bug

- **The overlay can occasionally render as a solid black rectangle, or not
  render at all, on some launches.** This is a known, unresolved,
  non-deterministic issue (see
  [KNOWN_ISSUES.md #1](KNOWN_ISSUES.md#1-overlay-occasionally-renders-black-or-invisible-unresolved)
  for the full technical writeup). If it happens: try moving the mouse off
  and back onto the overlay, or toggling Compact/Full (**Shift+Ins**) — that
  often forces a repaint. **This is the single most useful thing to report**:
  when it happened (right at launch? after a while?), and whether a
  mouse-move/toggle fixed it.
- **Multi-monitor / mixed-DPI setups haven't been tested against real
  hardware** (see
  [KNOWN_ISSUES.md #6](KNOWN_ISSUES.md#6-no-live-display-resize-testing-across-multiple-monitor-configurations)).
  If you run more than one monitor, or monitors at different DPI/scaling,
  and the overlay lands somewhere unexpected after a display change, that's
  useful to know.
- Tablet mod values for **Abyss, Irradiated, and Temple** tablets are
  plausible representative rolls, not confirmed against real game text — if
  you have one of these and it looks wrong, let me know what you actually
  see.
- The Juice Score and tablet-fit formulas are tuned against community
  guides and a handful of real waystones, not exhaustively validated —
  if a score feels obviously wrong for a waystone you're looking at, that's
  worth flagging too.

## How to report

Whatever's easiest for you — a message is fine. Useful details when
something looks wrong: what you were doing, a screenshot if it's visual, and
(for a bad score/recommendation) the waystone's text if you still have it
copied.

## Install / uninstall

Same as the main README: run the `.exe` installer (per-user, no admin
needed), Start Menu shortcut gets added. To remove: **Settings → Apps** →
"waystone-overlay".
