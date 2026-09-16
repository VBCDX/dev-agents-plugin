import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/a2a/server.js";
import { CANONICAL_IDS } from "../src/roles/registry.js";

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

test("GET /healthz returns 200 ok", async () => {
  const r = await req("/healthz");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: "ok" });
});

test("GET /agents/<id>.json returns the card with the a2a media type", async () => {
  const r = await req("/agents/code-agent.json");
  assert.equal(r.status, 200);
  assert.match(r.contentType, /^application\/a2a\+json/);
  assert.equal(r.body.name, "Code Agent");
  assert.equal(r.body.supportedInterfaces[0].url, `${BASE}/agents/code-agent.json`);
});

test("all sixteen canonical cards resolve with 200", async () => {
  let ok = 0;
  for (const id of CANONICAL_IDS) {
    const r = await req(`/agents/${id}.json`);
    if (r.status === 200) ok += 1;
  }
  assert.equal(ok, 16);
});

test("GET /agents/ index lists sixteen cards as application/json", async () => {
  const r = await req("/agents/");
  assert.equal(r.status, 200);
  assert.match(r.contentType, /^application\/json/);
  assert.equal(r.body.agents.length, 16);
  const alias = await req("/agents/index.json");
  assert.equal(alias.status, 200);
  assert.deepEqual(alias.body, r.body);
});

test("GET /.well-known/agent-card.json describes the server", async () => {
  const r = await req("/.well-known/agent-card.json");
  assert.equal(r.status, 200);
  assert.match(r.contentType, /^application\/a2a\+json/);
  assert.match(r.body.description, /discovery/i);
});

test("unknown agent id returns 404, not a partial card", async () => {
  const r = await req("/agents/not-a-real-agent.json");
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "not_found");
});

test("path traversal cannot escape the allowlist (encoded and raw forms)", async () => {
  const attacks = [
    "/agents/..%2f..%2f..%2fetc%2fpasswd.json",
    "/agents/%2e%2e%2f%2e%2e%2fpackage.json",
    "/agents/%2e%2e.json",
    "/agents/....json",
    "/agents/code-agent%00.json",
    "/agents/%2Fetc%2Fpasswd.json",
    "/agents/..%5c..%5cwindows.json",
  ];
  for (const path of attacks) {
    const r = await req(path);
    assert.equal(r.status, 404, `expected 404 for ${path}, got ${r.status}`);
    // Never leak file contents: a card would contain "supportedInterfaces".
    assert.ok(!r.text.includes("supportedInterfaces"), `leaked a card for ${path}`);
  }
});

test("a malformed percent-escape in the id returns 404, not a crash", async () => {
  const r = await req("/agents/%zz.json");
  assert.equal(r.status, 404);
});

test("non-GET methods are rejected with 405 and an Allow header", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const r = await req("/agents/code-agent.json", method);
    assert.equal(r.status, 405, `${method} should be 405`);
    assert.match(r.headers.get("allow") || "", /GET/);
  }
});

test("HEAD returns headers with no body", async () => {
  const r = await req("/agents/code-agent.json", "HEAD");
  assert.equal(r.status, 200);
  assert.match(r.contentType, /^application\/a2a\+json/);
  assert.equal(r.text, "");
});

test("unknown top-level path returns 404", async () => {
  const r = await req("/nope");
  assert.equal(r.status, 404);
});
