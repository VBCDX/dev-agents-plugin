// Canonical role loader. Reads the committed canonical assets — one prompt.md
// and one role.json per role under assets/roles/<id>/ — and exposes them as
// frozen descriptors. This is the single source of truth consumed by all four
// renderers; there is exactly one prompt and one descriptor per role, never a
// per-harness copy.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CANONICAL_IDS, idToSuffix, isCanonicalId } from "./registry.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ASSETS_DIR = join(here, "..", "..", "assets", "roles");

function loadRole(id) {
  const dir = join(ASSETS_DIR, id);
  const promptPath = join(dir, "prompt.md");
  const rolePath = join(dir, "role.json");
  if (!existsSync(promptPath)) throw new Error(`missing prompt for role ${id}: ${promptPath}`);
  if (!existsSync(rolePath)) throw new Error(`missing descriptor for role ${id}: ${rolePath}`);
  const prompt = readFileSync(promptPath, "utf8");
  const descriptor = JSON.parse(readFileSync(rolePath, "utf8"));
  if (descriptor.id !== id) {
    throw new Error(`descriptor id ${descriptor.id} does not match directory ${id}`);
  }
  if (descriptor.credential_suffix !== idToSuffix(id)) {
    throw new Error(`descriptor suffix ${descriptor.credential_suffix} inconsistent for ${id}`);
  }
  return Object.freeze({ id, prompt, descriptor: Object.freeze(descriptor) });
}

let cache = null;

/** All sixteen roles keyed by canonical ID, in canonical order. */
export function allRoles() {
  if (!cache) {
    cache = new Map();
    for (const id of CANONICAL_IDS) cache.set(id, loadRole(id));
  }
  return cache;
}

export function getRole(id) {
  if (!isCanonicalId(id)) return undefined;
  return allRoles().get(id);
}
