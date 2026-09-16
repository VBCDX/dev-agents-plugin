// Optional credential triples and private credential-file semantics
// (spec section 5).
//
// The installer reads at most one USER/TOKEN/PASSWORD triple per role from the
// literal config file, groups the three fields for a role together (they are
// not collisions), and — only for the requested selection — validates
// completeness. It writes <credentials-dir>/<role>.env at mode 0600 inside a
// 0700 directory, serialized so the companion service reader round-trips the
// values losslessly. It never invents a placeholder file, never borrows one
// role's credentials for another, and never lets a secret value reach a log,
// an error message, a manifest, or a command argument.

import { readFileSync } from "node:fs";
import { normalizeSuffix, isCanonicalId, isSafeId } from "../roles/registry.js";
import { parseEnvText } from "../config/env-parser.js";
import {
  atomicWrite, validateExistingFile, assertNoSymlinkComponents,
} from "../fs/safe-writer.js";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { configError, credentialError } from "../errors.js";

const FIELD_RE = /^VBCDX_AGENTS_(USER|TOKEN|PASSWORD)_(.+)$/;

/**
 * Collect credential triples from parsed config entries.
 *
 * @param {Map<string,string>} entries
 * @returns {Map<string,{role:string,known:boolean,user:string,token:string,password:string,rawSuffix:object}>}
 * Throws configError (exit 2) on ambiguous suffix spellings, duplicate
 * normalized fields, or unsafe role identifiers.
 */
export function collectCredentialTriples(entries) {
  const byRole = new Map();
  // Track, per (role, field), which raw suffix spelling set it — to detect
  // two spellings that normalize to the same role/field.
  const seen = new Map(); // `${role}:${field}` -> rawSuffix

  for (const [key, value] of entries) {
    const m = FIELD_RE.exec(key);
    if (!m) continue;
    const field = m[1].toLowerCase(); // user|token|password
    const rawSuffix = m[2];
    const role = normalizeSuffix(rawSuffix);
    if (!isSafeId(role)) {
      throw configError(`Credential key ${key} has an invalid role suffix; expected a canonical-style agent ID.`);
    }
    const sk = `${role}:${field}`;
    if (seen.has(sk) && seen.get(sk) !== rawSuffix) {
      throw configError(
        `Ambiguous credential keys for role ${role}: suffixes ${seen.get(sk)} and ${rawSuffix} normalize to the same field ${field}.`,
      );
    }
    if (byRole.get(role)?.[field] !== undefined && seen.get(sk) === rawSuffix) {
      // Same raw key twice would already be a duplicate rejected by the parser;
      // this guards a normalized duplicate from a different spelling.
      throw configError(`Duplicate credential field ${field} for role ${role}.`);
    }
    seen.set(sk, rawSuffix);
    if (!byRole.has(role)) {
      byRole.set(role, { role, known: isCanonicalId(role), user: "", token: "", password: "" });
    }
    byRole.get(role)[field] = value;
  }
  return byRole;
}

/** @returns {"disabled"|"complete"|"incomplete"} */
export function classifyTriple(triple) {
  const has = (v) => typeof v === "string" && v.trim() !== "";
  const anySet = has(triple.user) || has(triple.token) || has(triple.password);
  if (!anySet) return "disabled";
  if (has(triple.user) && (has(triple.token) || has(triple.password))) return "complete";
  return "incomplete";
}

/**
 * Serialize a credential file body. Values are JSON-quoted so the companion
 * reader's double-quoted (JSON-escaped) grammar decodes them back byte for
 * byte. ROLE is written first; USER, then whichever of TOKEN/PASSWORD are
 * nonblank. No blank field is emitted.
 */
export function serializeCredentialFile(triple) {
  const q = (v) => JSON.stringify(String(v));
  const lines = [`VBCDX_AGENTS_ROLE=${q(triple.role)}`];
  if (triple.user && triple.user.trim() !== "") lines.push(`VBCDX_AGENTS_USER=${q(triple.user)}`);
  if (triple.token && triple.token.trim() !== "") lines.push(`VBCDX_AGENTS_TOKEN=${q(triple.token)}`);
  if (triple.password && triple.password.trim() !== "") lines.push(`VBCDX_AGENTS_PASSWORD=${q(triple.password)}`);
  return lines.join("\n") + "\n";
}

/**
 * Inspect an existing credential file for a role.
 * @returns {{state:"absent"|"empty"|"valid"|"invalid"|"unsafe", reason?:string}}
 * Never returns or logs any credential value.
 */
export function evaluateExisting(absPath, role) {
  let st;
  try {
    assertNoSymlinkComponents(absPath);
    st = lstatSync(absPath);
  } catch (err) {
    if (err && err.code === "ENOENT") return { state: "absent" };
    return { state: "unsafe", reason: err.message };
  }
  if (st.isSymbolicLink() || !st.isFile()) {
    return { state: "unsafe", reason: "not a regular file (symlink or special file)" };
  }
  try {
    validateExistingFile(absPath, { secret: true });
  } catch (err) {
    return { state: "unsafe", reason: err.message };
  }
  const raw = readFileSync(absPath, "utf8");
  if (raw.trim() === "") return { state: "empty" };
  let parsed;
  try {
    parsed = parseEnvText(raw, absPath);
  } catch (err) {
    return { state: "invalid", reason: "malformed credential-file syntax" };
  }
  const fileRole = parsed.get("VBCDX_AGENTS_ROLE");
  const user = parsed.get("VBCDX_AGENTS_USER");
  const token = parsed.get("VBCDX_AGENTS_TOKEN");
  const password = parsed.get("VBCDX_AGENTS_PASSWORD");
  if (fileRole !== role) return { state: "invalid", reason: `role field is ${fileRole ?? "absent"}, expected ${role}` };
  const has = (v) => typeof v === "string" && v.trim() !== "";
  if (!has(user) && !has(token) && !has(password)) return { state: "empty" };
  // Installer input contract requires USER plus a token/password.
  if (!has(user) || !(has(token) || has(password))) {
    return { state: "invalid", reason: "missing required USER and TOKEN/PASSWORD fields" };
  }
  return { state: "valid" };
}

/**
 * Decide and (unless dry-run) perform the credential file operation for a
 * complete triple. Returns an action record with no secret values.
 *
 * @returns {{action:"written"|"retained"|"replaced", path:string}}
 */
export function writeCredentialFile({ credentialsDir, triple, force = false, dryRun = false }) {
  if (!isSafeId(triple.role)) {
    throw credentialError(`Unsafe credential role identifier: ${triple.role}.`);
  }
  const absPath = join(credentialsDir, `${triple.role}.env`);
  const existing = evaluateExisting(absPath, triple.role);

  if (existing.state === "unsafe") {
    throw credentialError(
      `Existing credential file at ${absPath} is unsafe (${existing.reason}); it fails even with --force. ` +
        `Remove or repair it (regular file, mode 0600, owned by you, in a 0700 directory) and rerun.`,
    );
  }
  if (existing.state === "invalid") {
    throw credentialError(
      `Existing credential file at ${absPath} is invalid (${existing.reason}); it fails even with --force. ` +
        `Fix its ROLE/fields or remove it, then rerun. No input credentials were applied.`,
    );
  }
  if (existing.state === "valid" && !force) {
    // Retain untouched; be explicit that new input was NOT applied.
    return { action: "retained", path: absPath };
  }

  const body = serializeCredentialFile(triple);
  if (dryRun) {
    return { action: existing.state === "valid" ? "replaced" : "written", path: absPath, planned: true };
  }
  atomicWrite(absPath, body, { mode: 0o600, secret: true });
  return { action: existing.state === "valid" ? "replaced" : "written", path: absPath };
}
