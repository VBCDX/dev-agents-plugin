// test/vendor/vbcdx is vbcdx's pack loader, overlay composer and schemas, copied byte-identical
// so this pack is tested with the code that will load it. SOURCE names the commit and the hash
// of every vendored file; an edit here, or a file added without a hash, fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "./pack.js";

const vendor = join(ROOT, "test", "vendor", "vbcdx");
const listed = readFileSync(join(vendor, "SOURCE"), "utf8").split("\n").filter((l) => /^[0-9a-f]{64}  /.test(l));

test("every vendored vbcdx file matches the hash SOURCE records, and none is unlisted", () => {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(relative(vendor, p)); } };
  walk(vendor);
  const hashed = listed.map((l) => l.slice(66));
  assert.deepEqual(files.filter((f) => f !== "SOURCE").sort(), [...hashed].sort());
  for (const line of listed) {
    const [hash, file] = [line.slice(0, 64), line.slice(66)];
    assert.equal(createHash("sha256").update(readFileSync(join(vendor, file))).digest("hex"), hash, file);
  }
});
