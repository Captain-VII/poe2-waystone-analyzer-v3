/** Single source of truth for "is mechanic X present on this map" keyword
 *  regexes — two consumers used to keep their own copies that could
 *  silently drift apart (KNOWN_ISSUES #4's refactor, 2026-07-08):
 *  - `mechanics.ts`'s `MechanicDef.detect` (the mechanic-match bonus)
 *  - `scoring.ts`'s `POSITIVE_MOD_PATTERNS` ("extra content: X" display
 *    bonuses)
 *  Both now read from `MECHANIC_PATTERNS` below, so a wording fix (e.g. a
 *  plural) only needs to happen once. Every consumer runs these against
 *  `ParsedWaystone.contentText` (parser.ts) — every block except the
 *  header, so the item's own NAME can never false-positive a match.
 *
 *  2026-07-10: Heist/Sanctum/Harvest/Metamorph/Incursion/Bestiary were
 *  removed — no real PoE2 tablet (mechanics.ts's `MechanicDef` entries for
 *  them were cut the same day) and no other consumer either. Blight/
 *  Legion/Essence survived that pass (they fed the Juice Score's mechanic-
 *  density term) but that term itself was cut in the 2026-07-1x composite-
 *  score rework (dominant-stat-plus-bonus model, scoring.ts) — with no
 *  tablet and no other consumer left, they're pure dead weight now too. */

export const MECHANIC_PATTERNS = {
  // Instilled waystones read "Players in Area are X% Delirious" — the word
  // "Delirium" never appears on the item, so match both forms.
  delirium: /\bdeliri(?:um|ous)\b/i,
  expedition: /\bexpedition\b/i,
  // "Abysses" is the real plural on tablet/waystone mods ("Adds Abysses to
  // a Map") — \babyss\b alone misses it.
  abyss: /\babyss(?:al|es)?\b/i,
  ritual: /\britual\b/i,
  breach: /\bbreach(?:es)?\b/i,
  irradiated: /\birradiat(?:ed|ion)\b/i,
  temple: /\btemple\b|vaal beacon/i,
} as const satisfies Record<string, RegExp>;

export type MechanicPatternId = keyof typeof MECHANIC_PATTERNS;

/** Display-only "extra content: X" bonus points (scoring.ts's
 *  POSITIVE_MOD_PATTERNS) — exact current membership + weights. Order
 *  matters: it drives bonusDetails/insights display order. */
export const EXTRA_CONTENT_BONUS: Readonly<Record<string, number>> = {
  ritual: 10,
  breach: 10,
  delirium: 8,
  expedition: 8,
};
