// Shared safe writer (spec section 9).
//
// Every managed mutation in the installer — generated definitions, credential
// files, staged plans, the manifest — goes through this module. It is the one
// place that enforces path safety, ownership, permissions, atomicity, and
// locking, so no caller can accidentally follow a symlink, widen a secret's
// mode, or leave a half-written file behind.
//
// Guarantees:
//   * No path component of a managed destination is a symlink (checked before
//     and again at mutation time to defeat TOCTOU swaps).
//   * Existing regular targets are owned by the effective user; secret files
//     additionally require 0600 in a 0700 parent, and the restrictive mode is
//     applied to the temp file BEFORE any secret content is written.
//   * Writes are atomic: content goes to a same-directory temp file, is fsynced
//     and renamed over the destination. A failure cleans up its temp file.
//   * Locks are exclusive per destination, acquired in a stable (sorted) order
//     to avoid deadlock; dry-run takes no lock and performs no write.
//
// This module never removes a directory recursively and never deletes files it
// did not create. Multi-file operations are NOT globally transactional and this
// module does not pretend otherwise; callers report partial effects.

import {
  openSync, closeSync, writeSync, fsyncSync, renameSync, unlinkSync, mkdirSync,
  lstatSync, statSync, realpathSync, readFileSync, constants as fsc,
} from "node:fs";
import { dirname, join, isAbsolute, sep } from "node:path";
import { createHash } from "node:crypto";
import { filesystemError } from "../errors.js";

export function isPosix() {
  return typeof process.getuid === "function";
}

function requirePosix() {
  if (!isPosix()) {
    throw filesystemError(
      "This installer's filesystem-safety guarantees require a POSIX platform; other platforms are unsupported in v1.",
    );
  }
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Reject a path that is not an absolute path or contains a `..` component. */
export function assertManagedPath(absPath) {
  if (typeof absPath !== "string" || !isAbsolute(absPath)) {
    throw filesystemError(`Managed path must be absolute: ${String(absPath)}`);
  }
  const parts = absPath.split(sep);
  if (parts.some((p) => p === "..")) {
    throw filesystemError(`Managed path must not contain '..': ${absPath}`);
  }
}

/**
 * Walk the existing prefix of an absolute path and reject any symlink
 * component. The destination itself may be absent; if present it must be a
 * regular file (checked by the caller). Returns nothing; throws on violation.
 */
export function assertNoSymlinkComponents(absPath) {
  assertManagedPath(absPath);
  const parts = absPath.split(sep).filter(Boolean);
  let cur = sep;
  for (let i = 0; i < parts.length; i++) {
    cur = i === 0 ? sep + parts[0] : join(cur, parts[i]);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      return; // component does not exist yet; nothing below it can either
    }
    if (st.isSymbolicLink()) {
      throw filesystemError(`Refusing to traverse a symlink path component: ${cur}`);
    }
  }
}

/** Ensure a directory exists with the given mode, creating parents safely. */
export function ensureDir(absDir, mode = 0o755) {
  assertNoSymlinkComponents(absDir);
  mkdirSync(absDir, { recursive: true, mode });
}

/**
 * Validate an existing regular file for managed update/retention: it must be a
 * regular (non-symlink) file owned by the effective user. When `secret` is
 * true, require mode 0600 and a 0700 immediate parent. Returns the stat.
 */
export function validateExistingFile(absPath, { secret = false } = {}) {
  requirePosix();
  assertNoSymlinkComponents(absPath);
  const st = lstatSync(absPath);
  if (st.isSymbolicLink()) throw filesystemError(`Refusing a symlink: ${absPath}`);
  if (!st.isFile()) throw filesystemError(`Not a regular file: ${absPath}`);
  if (st.uid !== process.getuid()) {
    throw filesystemError(`File is not owned by the effective user: ${absPath}`);
  }
  if (secret) {
    const perm = st.mode & 0o777;
    if (perm !== 0o600) {
      throw filesystemError(`Credential file must be mode 0600: ${absPath}`);
    }
    const parent = dirname(absPath);
    const pst = lstatSync(parent);
    if ((pst.mode & 0o777) !== 0o700) {
      throw filesystemError(`Credential directory must be mode 0700: ${parent}`);
    }
    if (pst.uid !== process.getuid()) {
      throw filesystemError(`Credential directory is not owned by the effective user: ${parent}`);
    }
  }
  return st;
}

/**
 * Atomically write content to an absolute destination.
 *
 * @param {string} absPath  destination
 * @param {string|Buffer} content
 * @param {object} [opts]
 * @param {number} [opts.mode=0o644] final file mode; applied to the temp file
 *   before content is written so a secret never briefly exists world-readable
 * @param {boolean} [opts.secret=false] enforce a private parent directory
 * @returns {{digest: string, bytes: number}}
 */
export function atomicWrite(absPath, content, { mode = 0o644, secret = false } = {}) {
  requirePosix();
  assertNoSymlinkComponents(absPath);
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
  const dir = dirname(absPath);
  // Re-validate the destination at mutation time to defeat a swapped component.
  let existing;
  try {
    existing = lstatSync(absPath);
  } catch {
    existing = null;
  }
  if (existing && existing.isSymbolicLink()) {
    throw filesystemError(`Refusing to overwrite a symlink: ${absPath}`);
  }
  if (existing && !existing.isFile()) {
    throw filesystemError(`Refusing to overwrite a non-regular file: ${absPath}`);
  }
  if (secret) {
    const pst = lstatSync(dir);
    if ((pst.mode & 0o777) !== 0o700 || pst.uid !== process.getuid()) {
      throw filesystemError(`Credential directory must be a private 0700 dir owned by you: ${dir}`);
    }
  }
  const tmp = join(dir, `.vbcdx-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let fd;
  try {
    // O_EXCL: never follow/clobber an existing temp; create with the final mode.
    fd = openSync(tmp, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL, mode);
    writeSync(fd, buf);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, absPath);
  } catch (err) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
    try { unlinkSync(tmp); } catch { /* ignore: temp may not exist */ }
    if (err && err.code && err.code.startsWith("E")) {
      throw filesystemError(`Failed to write ${absPath}: ${err.code}.`);
    }
    throw err;
  }
  return { digest: sha256(buf), bytes: buf.length };
}

/** Read a file and return its sha256 digest, or null if absent. */
export function digestOf(absPath) {
  try {
    return sha256(readFileSync(absPath));
  } catch {
    return null;
  }
}

// ── Exclusive locks ─────────────────────────────────────────────────────────

/**
 * Acquire exclusive lockfiles for a set of destinations, in a stable sorted
 * order to avoid deadlock. Returns a release() function. Dry-run callers must
 * not call this. A lockfile is `<path>.lock` created with O_EXCL.
 */
export function acquireLocks(paths) {
  requirePosix();
  const ordered = [...new Set(paths)].sort();
  const held = [];
  try {
    for (const p of ordered) {
      assertNoSymlinkComponents(p);
      ensureDir(dirname(p));
      const lock = `${p}.lock`;
      let fd;
      try {
        fd = openSync(lock, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL, 0o600);
      } catch (err) {
        if (err && err.code === "EEXIST") {
          throw filesystemError(`Another operation holds the lock for ${p}; retry after it releases.`);
        }
        throw filesystemError(`Cannot acquire lock for ${p}: ${err.code || "error"}.`);
      }
      writeSync(fd, Buffer.from(`${process.pid}\n`));
      closeSync(fd);
      held.push(lock);
    }
  } catch (err) {
    for (const lock of held.reverse()) {
      try { unlinkSync(lock); } catch { /* ignore */ }
    }
    throw err;
  }
  return function release() {
    for (const lock of held.reverse()) {
      try { unlinkSync(lock); } catch { /* ignore */ }
    }
  };
}
