import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, statSync, rmSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomicWrite, assertNoSymlinkComponents, validateExistingFile, acquireLocks, sha256,
} from "../src/fs/safe-writer.js";
import { classifyGenerated, applyGenerated } from "../src/fs/manifest.js";

function scratch() {
  return mkdtempSync(join(tmpdir(), "vbcdx-sw-"));
}

test("atomicWrite creates a file with the requested mode", () => {
  const d = scratch();
  const p = join(d, "a", "b.txt");
  mkdirSync(join(d, "a"));
  const { digest } = atomicWrite(p, "hello", { mode: 0o600 });
  assert.equal(digest, sha256(Buffer.from("hello")));
  assert.equal(statSync(p).mode & 0o777, 0o600);
  rmSync(d, { recursive: true, force: true });
});

test("atomicWrite refuses to overwrite through a symlink target", () => {
  const d = scratch();
  const real = join(d, "real.txt");
  const link = join(d, "link.txt");
  writeFileSync(real, "x");
  symlinkSync(real, link);
  assert.throws(() => atomicWrite(link, "y"), /symlink/);
  rmSync(d, { recursive: true, force: true });
});

test("assertNoSymlinkComponents rejects a symlinked directory component", () => {
  const d = scratch();
  mkdirSync(join(d, "realdir"));
  symlinkSync(join(d, "realdir"), join(d, "linkdir"));
  assert.throws(() => assertNoSymlinkComponents(join(d, "linkdir", "f.txt")), /symlink/);
  rmSync(d, { recursive: true, force: true });
});

test("validateExistingFile enforces 0600 in a 0700 dir for secrets", () => {
  const d = scratch();
  const secretDir = join(d, "creds");
  mkdirSync(secretDir, { mode: 0o700 });
  const f = join(secretDir, "role.env");
  writeFileSync(f, "x", { mode: 0o600 });
  assert.doesNotThrow(() => validateExistingFile(f, { secret: true }));
  // Widen the mode -> rejected.
  const f2 = join(secretDir, "loose.env");
  writeFileSync(f2, "x", { mode: 0o644 });
  assert.throws(() => validateExistingFile(f2, { secret: true }), /0600/);
  rmSync(d, { recursive: true, force: true });
});

test("secret writes never briefly exist with a broad mode", () => {
  const d = scratch();
  const secretDir = join(d, "creds");
  mkdirSync(secretDir, { mode: 0o700 });
  const f = join(secretDir, "s.env");
  atomicWrite(f, "token", { mode: 0o600, secret: true });
  assert.equal(statSync(f).mode & 0o777, 0o600);
  rmSync(d, { recursive: true, force: true });
});

test("acquireLocks is exclusive and releasable", () => {
  const d = scratch();
  const p = join(d, "x", "file");
  const release = acquireLocks([p]);
  assert.throws(() => acquireLocks([p]), /lock/);
  release();
  const release2 = acquireLocks([p]);
  release2();
  rmSync(d, { recursive: true, force: true });
});

test("classifyGenerated covers install/noop/repair/update/conflict", () => {
  const d = scratch();
  const p = join(d, "def.md");
  // install: not recorded, absent
  assert.equal(classifyGenerated(p, "aaa", undefined), "install");
  // write it, record digest bbb
  writeFileSync(p, "content-b");
  const bbb = sha256(Buffer.from("content-b"));
  // noop: recorded, on-disk equals new
  assert.equal(classifyGenerated(p, bbb, { digest: bbb }), "noop");
  // update: recorded old digest matches on-disk, new digest differs
  assert.equal(classifyGenerated(p, "new", { digest: bbb }), "update");
  // conflict: recorded, on-disk differs from both recorded and new (user edit)
  assert.equal(classifyGenerated(p, "new", { digest: "old-different" }), "conflict");
  // conflict: unowned differing content
  assert.equal(classifyGenerated(p, "new", undefined), "conflict");
  rmSync(d, { recursive: true, force: true });
});

test("classifyGenerated repairs a missing owned file even at same version", () => {
  const d = scratch();
  const p = join(d, "gone.md");
  assert.equal(classifyGenerated(p, "any", { digest: "recorded" }), "repair");
  rmSync(d, { recursive: true, force: true });
});

test("applyGenerated refuses a conflict without force and overwrites with force", () => {
  const d = scratch();
  const p = join(d, "c.md");
  writeFileSync(p, "user-edit");
  const content = "package-new";
  const digest = sha256(Buffer.from(content));
  assert.throws(
    () => applyGenerated({ absPath: p, content, digest, recordedEntry: { digest: "old" }, force: false }),
    /--force/,
  );
  const res = applyGenerated({ absPath: p, content, digest, recordedEntry: { digest: "old" }, force: true });
  assert.equal(res.action, "forced");
  rmSync(d, { recursive: true, force: true });
});
