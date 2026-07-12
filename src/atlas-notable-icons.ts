/** Atlas Tree notable/keystone icons — UI layer only, same split as
 *  atlas-master-icons.ts (kept out of adapter.ts's image-free dependency
 *  graph). Downloaded and bundled locally from Mobalytics' CDN
 *  (Fubgun's live Atlas Tree, "Atlas Tree" tab — each notable's own
 *  aria-label/img pair, 2026-07-12) rather than hotlinked — offline-first. */

import unexpectedMissions from "./assets/atlas-notables/unexpected-missions.png";
import unforeseenThreats from "./assets/atlas-notables/unforeseen-threats.png";
import easternKnowledge from "./assets/atlas-notables/eastern-knowledge.png";
import partialTranslations from "./assets/atlas-notables/partial-translations.png";
import keenAppraisal from "./assets/atlas-notables/keen-appraisal.png";

export const ATLAS_NOTABLE_ICONS: Record<string, string> = {
  "Unexpected Missions": unexpectedMissions,
  "Unforeseen Threats": unforeseenThreats,
  "Eastern Knowledge": easternKnowledge,
  "Partial Translations": partialTranslations,
  "Keen Appraisal": keenAppraisal,
};
