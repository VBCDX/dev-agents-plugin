// Installation manifest and update-ownership classifier (spec section 9).
//
// The manifest records, for each generated (non-secret) definition the
// installer owns, the last-written digest, mode, owning package version, and
// which role/harness produced it. Credential values and credential files are
// never recorded here. The classifier decides, for a planned write, whether it
// is a fresh install, a no-op, a repair of a missing owned file, an ownership
// respecting update, or a conflict that requires --force.

import { readFileSync } from "node:fs";
import { atomicWrite, digestOf, validateExistingFile } from "./safe-writer.js";
import { conflictError, filesystemError } from "../errors.js";

const MANIFEST_SCHEMA = 1;
const PACKAGE_NAME = "@vbcdx/dev-agents";

export function emptyManifest(packageVersion) {
  return { schema_version: MANIFEST_SCHEMA, package: PACKAGE_NAME, package_version: packageVersion, files: {} };
}

/** Read a manifest from an absolute path; return an empty manifest if absent. */
export function readManifest(absPath, packageVersion) {
  let raw;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch {
    return emptyManifest(packageVersion);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt manifest: fail conservatively rather than claim ownership.
    throw filesystemError(`Installation manifest is corrupt and cannot be trusted: ${absPath}. Remove or repair it before rerunning.`);
  }
  if (!parsed || parsed.schema_version !== MANIFEST_SCHEMA || typeof parsed.files !== "object" || parsed.files === null) {
    throw filesystemError(`Installation manifest is an unsupported shape: ${absPath}.`);
  }
  if (parsed.package && parsed.package !== PACKAGE_NAME) {
    throw filesystemError(`Installation manifest belongs to a different package (${parsed.package}): ${absPath}.`);
  }
  return parsed;
}

export function writeManifest(absPath, manifest) {
  return atomicWrite(absPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644 });
}

/**
 * Classify a planned write against on-disk state and the manifest entry.
 *
 * @returns {"install"|"noop"|"repair"|"update"|"conflict"} the classification.
 * "conflict" means the caller must refuse unless --force was given.
 */
export function classifyGenerated(absPath, newDigest, recordedEntry) {
  const onDisk = digestOf(absPath);
  const owned = Boolean(recordedEntry && recordedEntry.digest);

  if (owned) {
    if (onDisk === null) return "repair"; // missing owned file — repair even if version unchanged
    if (onDisk === newDigest) return "noop"; // already the desired content
    if (onDisk === recordedEntry.digest) return "update"; // still ours; move to new content
    return "conflict"; // user modified a package-owned file
  }
  // Not recorded as owned.
  if (onDisk === null) return "install";
  if (onDisk === newDigest) return "noop"; // identical unowned content — adopt without change
  return "conflict"; // unowned differing content
}

/**
 * Apply a planned generated-file write according to its classification.
 * Returns the action actually taken. Callers pass `force` to override a
 * conflict (which still runs full safety validation before overwriting).
 */
export function applyGenerated({ absPath, content, digest, mode = 0o644, recordedEntry, force = false }) {
  const cls = classifyGenerated(absPath, digest, recordedEntry);
  if (cls === "noop") {
    if (digestOf(absPath) !== null) validateExistingFile(absPath); // safety-validate before trusting
    return { action: "noop", digest };
  }
  if (cls === "conflict" && !force) {
    throw conflictError(
      `Refusing to overwrite ${absPath}: it was modified outside the installer or is not package-owned. Rerun with --force to replace it.`,
    );
  }
  if (digestOf(absPath) !== null) validateExistingFile(absPath); // owner/symlink/regular checks before overwrite
  const res = atomicWrite(absPath, content, { mode });
  return { action: cls === "conflict" ? "forced" : cls, digest: res.digest };
}
