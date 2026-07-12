/** Danger list — Full-mode rendering of `AnalysisResult.dangerHits`
 *  (severity-grouped warnings). Pure string renderer + one delegated
 *  toggle binder, same vanilla pattern as RelicPanel. `DangerHitView.severity`
 *  arrives already collapsed to this 3-tier scale (adapter.ts's job — see
 *  its `UI_SEVERITY` map); this component only groups/renders, it never
 *  reasons about the analyzer's internal reflect/strong/moderate/minor
 *  vocabulary and never feeds anything back into dangerLevel/score. */

import type { DangerHitView } from "../types";

type VisualTier = DangerHitView["severity"];

// Text glyphs, not color emoji — colored per tier in CSS like the rest of
// the panel's iconography (⚠/◆/+ in RelicPanel). "high" has no heading:
// the Insights column's danger-badge already spells out "Very Dangerous"
// right above this list, so a "High" group header directly under it was
// pure duplication (2026-07-12, user request) — medium/low still get
// theirs since nothing else on the card names their severity.
const TIER_META: Record<VisualTier, { heading: string; icon: string }> = {
  high: { heading: "", icon: "⚠" },
  medium: { heading: "Medium", icon: "⚡" },
  low: { heading: "Low", icon: "•" },
};

const TIER_ORDER: VisualTier[] = ["high", "medium", "low"];

/** LOW rows beyond this count are hidden behind a "+N more" toggle. */
const LOW_VISIBLE_MAX = 3;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Stable grouping: hits arrive severity-sorted from the adapter, and
 *  filter preserves order, so within-group order is the analyzer's. */
function groupByTier(hits: DangerHitView[]): Record<VisualTier, DangerHitView[]> {
  const groups: Record<VisualTier, DangerHitView[]> = { high: [], medium: [], low: [] };
  for (const hit of hits) groups[hit.severity].push(hit);
  return groups;
}

function row(hit: DangerHitView, tier: VisualTier, hidden: boolean): string {
  return `<div class="dl-row dl-${tier}${hidden ? " dl-hidden" : ""}"><span class="dl-ic">${
    TIER_META[tier].icon
  }</span><span class="dl-lab">${esc(hit.label)}</span></div>`;
}

/** Renders the grouped danger list as an HTML string, or "" when there are
 *  no hits (the surrounding Insights column renders its own content; an
 *  explicit empty-state line would just add noise). */
export function renderDangerList(hits: DangerHitView[]): string {
  if (hits.length === 0) return "";

  const groups = groupByTier(hits);
  const parts: string[] = [];

  for (const tier of TIER_ORDER) {
    const group = groups[tier];
    if (group.length === 0) continue;

    if (TIER_META[tier].heading) parts.push(`<div class="dl-group-h dl-${tier}">${TIER_META[tier].heading}</div>`);

    const collapsible = tier === "low" && group.length > LOW_VISIBLE_MAX;
    group.forEach((hit, i) => parts.push(row(hit, tier, collapsible && i >= LOW_VISIBLE_MAX)));
    if (collapsible) {
      const hiddenCount = group.length - LOW_VISIBLE_MAX;
      parts.push(
        `<button class="dl-more" type="button" data-dl-toggle data-more="+${hiddenCount} more" data-less="− less">+${hiddenCount} more</button>`,
      );
    }
  }

  return `<div class="danger-list">${parts.join("")}</div>`;
}

/** One delegated listener on a stable ancestor (the insights container
 *  survives innerHTML re-renders; the list itself doesn't). Clicks work in
 *  Full mode because the insights column is already in the click-through
 *  whitelist — no interactive-rect changes needed. */
export function bindDangerListToggle(container: HTMLElement): void {
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-dl-toggle]");
    if (!btn) return;
    const list = btn.closest(".danger-list");
    if (!list) return;
    const expanded = list.classList.toggle("dl-expanded");
    btn.textContent = expanded ? btn.dataset.less! : btn.dataset.more!;
  });
}
