// Provenance shared by the derivation helpers (NOT part of the published pack).
//
// The roles are the ones vbcdx-pack.json declares, in its order. Each was ported from a
// source persona (see derive-prompts.mjs); only two source names differ from the role id.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const ROLE_IDS = Object.freeze(JSON.parse(readFileSync(join(here, "..", "vbcdx-pack.json"), "utf8")).roles);

const RENAMED = { "all-in-one-dev-agent": "all-tools", "reward-hack-auditor-agent": "reward-hack-auditor" };

/** Source persona name -> role id. */
export const SOURCE_TO_CANONICAL = Object.freeze(Object.fromEntries(ROLE_IDS.map((id) => [RENAMED[id] || id, id])));

/** The credential suffix vbcdx derives from a role id: upper-cased, hyphens as underscores. */
export const idToSuffix = (id) => id.toUpperCase().replace(/-/g, "_");
