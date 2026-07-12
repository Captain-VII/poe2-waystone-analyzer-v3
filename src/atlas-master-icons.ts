/** Atlas Master icons — UI layer only, kept out of adapter.ts's
 *  dependency graph (see analyzer/atlas-masters.ts's header comment for
 *  why). Downloaded and bundled locally from Mobalytics' CDN
 *  (`CircularButton_A/B/C_Active`, cross-checked against real in-game
 *  screenshots 2026-07-12: A = Jado, B = Hilda, C = Doryani) rather than
 *  hotlinked — this app is offline-first. */

import jado from "./assets/atlas-masters/jado.png";
import hilda from "./assets/atlas-masters/hilda.png";
import doryani from "./assets/atlas-masters/doryani.png";

export const ATLAS_MASTER_ICONS: Record<string, string> = { Jado: jado, Hilda: hilda, Doryani: doryani };
