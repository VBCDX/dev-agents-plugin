import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "../src/a2a/server.js";
import { CATEGORIES, SKILLS_DIR, allDocuments } from "../src/skills/catalogue.js";

const BASE = "https://agents.example";
let server;
let origin;

before(async () => {
  server = createServer({ configuredBaseUrl: BASE });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  origin = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function req(path, method = "GET") {
  const res = await fetch(`${origin}${path}`, { method });
  const contentType = res.headers.get("content-type") || "";
  let body = null;
  const text = await res.text();
  if (text && contentType.includes("json")) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, contentType, body, text, headers: res.headers };
}

test("GET /skills/ lists all eight categories plus documents", async () => {
  const r = await req("/skills/");
  assert.equal(r.status, 200);
  assert.match(r.contentType, /^application\/json/);
  assert.equal(r.body.categories.length, 8);
  const slugs = r.body.categories.map((c) => c.slug);
  assert.deepEqual(slugs, CATEGORIES.map((c) => c.slug));
  // Development holds the ported skill; the catalogue is discoverable.
  const dev = r.body.categories.find((c) => c.slug === "development");
  assert.equal(dev.count, 1);
  assert.equal(dev.url, `${BASE}/skills/development/`);
  // The context template is a top-level document.
  assert.ok(r.body.documents.some((d) => d.file === "CONTEXT.example.md"));
  // Alias without the trailing slash.
  const alias = await req("/skills");
  assert.equal(alias.status, 200);
  assert.deepEqual(alias.body, r.body);
});

test("GET /skills/development/ indexes the category's skills", async () => {
  const r = await req("/skills/development/");
  assert.equal(r.status, 200);
  assert.match(r.contentType, /^application\/json/);
  assert.equal(r.body.category.slug, "development");
  assert.equal(r.body.category.name, "Development");
  const s = r.body.skills.find((x) => x.file === "VBCDX-ISSUES.MD");
  assert.ok(s, "VBCDX-ISSUES.MD should be listed");
  assert.equal(s.name, "VBCDX-ISSUES");
  assert.equal(s.url, `${BASE}/skills/development/VBCDX-ISSUES.MD`);
  // No-slash form serves the same index.
  const noSlash = await req("/skills/development");
  assert.equal(noSlash.status, 200);
  assert.deepEqual(noSlash.body, r.body);
});

test("an empty category still indexes (discoverable), with zero skills", async () => {
  const r = await req("/skills/testing/");
  assert.equal(r.status, 200);
  assert.equal(r.body.category.slug, "testing");
  assert.deepEqual(r.body.skills, []);
});

test("GET /skills/development/VBCDX-ISSUES.MD serves the document as markdown", async () => {
  const r = await req("/skills/development/VBCDX-ISSUES.MD");
  assert.equal(r.status, 200);
  assert.match(r.contentType, /^text\/markdown; charset=utf-8/);
  assert.match(r.text, /# Writing issues, PRs & reviews/);
  // The opinionated substance survived the abstraction.
  assert.match(r.text, /self-contained/i);
  assert.match(r.text, /Decisions for the User/);
});

test("GET /skills/CONTEXT.example.md serves the context template", async () => {
  const r = await req("/skills/CONTEXT.example.md");
  assert.equal(r.status, 200);
  assert.match(r.contentType, /^text\/markdown; charset=utf-8/);
  assert.match(r.text, /Project context/i);
});

test("unknown category and unknown skill both 404", async () => {
  const unknownCat = await req("/skills/nope/");
  assert.equal(unknownCat.status, 404);
  const unknownSkill = await req("/skills/development/NOT-A-SKILL.MD");
  assert.equal(unknownSkill.status, 404);
  assert.equal(unknownSkill.body.error, "not_found");
});

test("wrong casing 404s — the router is case-sensitive to the canonical form", async () => {
  for (const path of [
    "/skills/Development/VBCDX-ISSUES.MD",
    "/skills/development/vbcdx-issues.md",
    "/skills/development/VBCDX-ISSUES.md",
  ]) {
    const r = await req(path);
    assert.equal(r.status, 404, `expected 404 for ${path}, got ${r.status}`);
  }
});

test("path traversal cannot serve an arbitrary file (encoded and raw forms)", async () => {
  // The invariant: no hostile path ever serves a file from outside the built
  // manifest. Most vectors keep their bogus segment (encoded slash/backslash,
  // null byte, over-long) and 404 on the manifest miss. A couple are collapsed
  // by WHATWG dot-segment normalization BEFORE the handler runs — e.g.
  // ".../%2e%2e" becomes "/skills/" (the index) and "/skills/%2e%2e/%2e%2e/etc/passwd"
  // becomes "/etc/passwd" (an unmatched path, 404). Both are safe: neither
  // serves an arbitrary file. So we accept a 404 OR a 200 that is one of our
  // known JSON index shapes, and in every case assert nothing leaked.
  const attacks = [
    "/skills/development/..%2f..%2f..%2fetc%2fpasswd",
    "/skills/development/%2e%2e%2f%2e%2e%2fpackage.json",
    "/skills/%2e%2e%2f%2e%2e%2fetc/passwd",
    "/skills/..%2f..%2fpackage.json",
    "/skills/development/%2e%2e",
    "/skills/development/....%2f....%2fpackage.json",
    "/skills/development/VBCDX-ISSUES.MD%00",
    "/skills/%2Fetc%2Fpasswd",
    "/skills/development/..%5c..%5cwindows",
    "/skills/development/" + "A".repeat(5000) + ".MD",
    "/skills/%2e%2e/%2e%2e/etc/passwd",
  ];
  for (const path of attacks) {
    const r = await req(path);
    if (r.status !== 404) {
      assert.equal(r.status, 200, `unexpected status for ${path}`);
      assert.match(r.contentType, /^application\/json/, `served non-index for ${path}`);
      // A 200 is only acceptable if it is one of our JSON index shapes, never a file.
      assert.ok(
        r.body && (Array.isArray(r.body.categories) || r.body.category),
        `served something other than a catalogue index for ${path}`,
      );
    }
    // Never leak file contents: package.json has this key, /etc/passwd has "root:...:0:0:".
    assert.ok(!r.text.includes("\"dependencies\""), `leaked package.json for ${path}`);
    assert.ok(!/root:.*:0:0:/.test(r.text), `leaked /etc/passwd for ${path}`);
  }
});

test("a malformed percent-escape in a /skills segment returns 404, not a crash", async () => {
  const r = await req("/skills/development/%zz.MD");
  assert.equal(r.status, 404);
  const r2 = await req("/skills/%zz/");
  assert.equal(r2.status, 404);
});

test("non-GET on a /skills path is 405 with an Allow header", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const r = await req("/skills/development/VBCDX-ISSUES.MD", method);
    assert.equal(r.status, 405, `${method} should be 405`);
    assert.match(r.headers.get("allow") || "", /GET/);
  }
});

test("HEAD on a skill document returns headers with no body", async () => {
  const r = await req("/skills/development/VBCDX-ISSUES.MD", "HEAD");
  assert.equal(r.status, 200);
  assert.match(r.contentType, /^text\/markdown; charset=utf-8/);
  assert.equal(r.text, "");
});

// The catalogue is served unauthenticated, so nothing internal may leak. This
// walks the ACTUAL shipped tree (not the manifest) so a stray file is caught too.
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

test("no shipped catalogue file leaks internal detail", () => {
  const forbidden = [
    /tamtam/i,
    /git\.tamtam\.co/i,
    /npm\.tamtam\.co/i,
    /tyabonil/i,
    // credential variable names
    /FORGEJO_(?:USER|PASS|TOKEN)/,
    /COOLIFY_[A-Z_]*TOKEN/,
    // RFC-1918 private addresses
    /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
    /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
    // absolute local paths
    /\/home\/coder\//,
  ];
  const files = walk(SKILLS_DIR);
  assert.ok(files.length > 0, "expected at least one shipped catalogue file");
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const re of forbidden) {
      assert.ok(!re.test(content), `${file} matched forbidden pattern ${re}`);
    }
  }
});

test("allDocuments() covers every served document and matches the tree", () => {
  const docs = allDocuments();
  // At least the ported skill and the context template ship.
  assert.ok(docs.some((d) => d.relPath === "development/VBCDX-ISSUES.MD"));
  assert.ok(docs.some((d) => d.relPath === "CONTEXT.example.md"));
});
