/** Single source of truth for "is mechanic X present on this map" keyword
 *  regexes — three consumers used to keep their own copies that could
 *  silently drift apart (KNOWN_ISSUES #4's refactor, 2026-07-08):
 *  - `mechanics.ts`'s `MechanicDef.detect` (the mechanic-match bonus)
 *  - `scoring.ts`'s `MECHANIC_SYNERGY_PATTERNS` (mechanic-density term,
 *    feeds the real Juice Score)
 *  - `scoring.ts`'s `POSITIVE_MOD_PATTERNS` ("extra content: X" display
 *    bonuses)
 *  All three now read from `MECHANIC_PATTERNS` below, so a wording fix
 *  (e.g. a plural) only needs to happen once. Every consumer runs these
 *  against `ParsedWaystone.contentText` (parser.ts) — every block except
 *  the header, so the item's own NAME can never false-positive a match.
 *
 *  2026-07-10: Heist/Sanctum/Harvest/Metamorph/Incursion/Bestiary were
 *  removed — they had no real PoE2 tablet (mechanics.ts's `MechanicDef`
 *  entries for them were cut the same day) and, unlike Blight/Legion/
 *  Essence, no other consumer either (not in `SYNERGY_MECHANIC_IDS` or
 *  `EXTRA_CONTENT_BONUS` below) — pure dead weight. Blight/Legion/Essence
 *  stay: they still drive the real Juice Score's mechanic-density term
 *  even without a tablet-matching entry of their own. */

export const MECHANIC_PATTERNS = {
  blight: /\bblight\b/i,
  // Instilled waystones read "Players in Area are X% Delirious" — the word
  // "Delirium" never appears on the item, so match both forms.
  delirium: /\bdeliri(?:um|ous)\b/i,
  expedition: /\bexpedition\b/i,
  legion: /\blegion\b/i,
  // "Abysses" is the real plural on tablet/waystone mods ("Adds Abysses to
  // a Map") — \babyss\b alone misses it.
  abyss: /\babyss(?:al|es)?\b/i,
  ritual: /\britual\b/i,
  breach: /\bbreach(?:es)?\b/i,
  // Plural: "Area contains X additional Essences".
  essence: /\bessences?\b/i,
  irradiated: /\birradiat(?:ed|ion)\b/i,
  temple: /\btemple\b|vaal beacon/i,
} as const satisfies Record<string, RegExp>;

export type MechanicPatternId = keyof typeof MECHANIC_PATTERNS;

/** Score-affecting mechanic-density/synergy subset (scoring.ts) — exact
 *  current membership, do not add/remove without re-checking
 *  computeBaseScore's MECHANIC_REFERENCE/MECHANIC_WEIGHT calibration. */
export const SYNERGY_MECHANIC_IDS: readonly MechanicPatternId[] = [
  "delirium",
  "breach",
  "ritual",
  "abyss",
  "expedition",
  "legion",
  "essence",
  "blight",
];

/** Display-only "extra content: X" bonus points (scoring.ts's
 *  POSITIVE_MOD_PATTERNS) — exact current membership + weights. Order
 *  matters: it drives bonusDetails/insights display order. */
export const EXTRA_CONTENT_BONUS: Readonly<Record<string, number>> = {
  ritual: 10,
  breach: 10,
  delirium: 8,
  expedition: 8,
};
