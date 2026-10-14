// The pack as vbcdx loads it: vbcdx-pack.json, every role.json validated against vbcdx's role
// schema, and every prompt composed with no overlay (slots take their defaults, variables their
// values), the text a plain install renders. The loader is vbcdx's own, vendored under
// test/vendor/vbcdx until @vbcdx/vbcdx is published.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPack } from "./vendor/vbcdx/src/packs/load.js";
import { composeRoles } from "./vendor/vbcdx/src/overlays/overlay.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const pack = readPack(ROOT);
const composed = composeRoles([pack], []);

export const CANONICAL_IDS = Object.freeze(pack.roles.map((r) => r.id));
export const idToSuffix = (id) => id.toUpperCase().replace(/-/g, "_");
export const normalizeSuffix = (suffix) => suffix.toLowerCase().replace(/_/g, "-");
export const SUFFIX_TO_ID = Object.freeze(Object.fromEntries(CANONICAL_IDS.map((id) => [idToSuffix(id), id])));

/** One role as a plain install renders it: { id, prompt, descriptor }. */
export function getRole(id) {
  const role = pack.roles.find((r) => r.id === id);
  if (!role) throw new Error(`unknown role ${id}`);
  return Object.freeze({ id, prompt: composed.get(id).prompt, descriptor: role.descriptor });
}

export const allRoles = () => new Map(CANONICAL_IDS.map((id) => [id, getRole(id)]));
