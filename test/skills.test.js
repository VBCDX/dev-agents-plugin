// The skills this pack ships (vbcdx-pack.json skills_dir): each is a markdown skill with a name
// and a description, and none names a deployment, a credential variable, a private address or a
// local path. Serving them is vbcdx's job (its A2A server and catalogue tests); what they say is
// this pack's. The patterns are built from fragments so this file can sit in a scanned tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, pack } from "./pack.js";

const j = (...parts) => parts.join("");
const SKILLS_DIR = join(ROOT, JSON.parse(readFileSync(join(ROOT, "vbcdx-pack.json"), "utf8")).skills_dir);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test("no shipped skill file leaks internal detail", () => {
  const forbidden = [
    new RegExp(j("tam", "tam"), "i"),
    new RegExp(j("tya", "bonil"), "i"),
    // credential variable names
    new RegExp(j("FORGEJO_", "(?:USER|PASS|TOKEN)")),
    new RegExp(j("COOLIFY_", "[A-Z_]*TOKEN")),
    // RFC-1918 private addresses
    /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
    /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
    // absolute local paths
    new RegExp(j("/home", "/[a-z]+/")),
  ];
  const files = walk(SKILLS_DIR);
  assert.ok(files.length > 0, "expected at least one shipped skill file");
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const re of forbidden) assert.ok(!re.test(content), `${file} matched forbidden pattern ${re}`);
  }
});

test("every skill document has a name and a description, and vbcdx finds them", () => {
  const docs = walk(SKILLS_DIR).filter((f) => /\.md$/i.test(f) && !/CONTEXT\.example\.md$/.test(f));
  assert.ok(docs.length > 0);
  for (const file of docs) {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, "utf8"));
    assert.ok(front, `${file} has frontmatter`);
    assert.match(front[1], /^name: [a-z0-9-]+$/m, `${file} names the skill`);
    assert.match(front[1], /^description: .{20,}$/m, `${file} describes the skill`);
  }
  assert.equal(pack.skillsDir, realpathSync(SKILLS_DIR), "vbcdx loads the skills directory the pack declares");
});
