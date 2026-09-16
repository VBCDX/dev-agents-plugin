import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIntegrations, validateManifest } from "../src/config/integrations.js";

function scratch() {
  return mkdtempSync(join(tmpdir(), "vbcdx-int-"));
}

function forgejoManifest(overrides = {}) {
  return {
    schema_version: 1,
    service: "forgejo",
    contract: "vbcdx.forgejo/1",
    package_version: "1.0.0",
    tools: [
      { name: "create_comment", description: "d", inputSchema: {}, outputSchema: {}, effect: "write", required_permissions: ["write:issue"] },
      { name: "whoami", description: "d", inputSchema: {}, outputSchema: {}, effect: "read", required_permissions: ["read:user"] },
    ],
    ...overrides,
  };
}

test("validateManifest accepts a well-formed sorted manifest", () => {
  const names = validateManifest(forgejoManifest(), "forgejo", "m.json");
  assert.deepEqual(names, ["create_comment", "whoami"]);
});

test("validateManifest rejects an unsorted tools array", () => {
  const m = forgejoManifest();
  m.tools = m.tools.reverse();
  assert.throws(() => validateManifest(m, "forgejo", "m.json"), /sorted by name/);
});

test("validateManifest rejects a wrong contract and bad effect", () => {
  assert.throws(() => validateManifest(forgejoManifest({ contract: "vbcdx.forgejo/2" }), "forgejo", "m"), /contract/);
  const m = forgejoManifest();
  m.tools[0].effect = "mutate";
  assert.throws(() => validateManifest(m, "forgejo", "m"), /invalid effect/);
});

test("loadIntegrations validates the file and referenced manifests", () => {
  const d = scratch();
  const mf = join(d, "forgejo.json");
  writeFileSync(mf, JSON.stringify(forgejoManifest()));
  const intf = join(d, "integrations.json");
  writeFileSync(intf, JSON.stringify({
    schema_version: 1,
    services: {
      forgejo: {
        server_name: "forgejo",
        manifest_file: mf,
        credentials: { "code-agent": join(d, "code-agent.env") },
      },
    },
  }));
  const res = loadIntegrations(intf);
  assert.equal(res.services.forgejo.contract, "vbcdx.forgejo/1");
  assert.deepEqual(res.services.forgejo.tools, ["create_comment", "whoami"]);
  assert.equal(res.services.forgejo.credentials["code-agent"], join(d, "code-agent.env"));
  rmSync(d, { recursive: true, force: true });
});

test("loadIntegrations rejects an unknown service and wrong server_name", () => {
  const d = scratch();
  const bad = join(d, "bad.json");
  writeFileSync(bad, JSON.stringify({ schema_version: 1, services: { gitlab: {} } }));
  assert.throws(() => loadIntegrations(bad), /Unknown service/);
  const mf = join(d, "forgejo.json");
  writeFileSync(mf, JSON.stringify(forgejoManifest()));
  const wrongName = join(d, "wrongname.json");
  writeFileSync(wrongName, JSON.stringify({
    schema_version: 1,
    services: { forgejo: { server_name: "code-host", manifest_file: mf, credentials: {} } },
  }));
  assert.throws(() => loadIntegrations(wrongName), /server_name must be exactly/);
  rmSync(d, { recursive: true, force: true });
});

test("loadIntegrations rejects a non-canonical credential role", () => {
  const d = scratch();
  const mf = join(d, "forgejo.json");
  writeFileSync(mf, JSON.stringify(forgejoManifest()));
  const f = join(d, "int.json");
  writeFileSync(f, JSON.stringify({
    schema_version: 1,
    services: { forgejo: { server_name: "forgejo", manifest_file: mf, credentials: { "coder-agent": join(d, "x.env") } } },
  }));
  assert.throws(() => loadIntegrations(f), /not a canonical agent ID/);
  rmSync(d, { recursive: true, force: true });
});

test("loadIntegrations rejects duplicate JSON keys", () => {
  const d = scratch();
  const f = join(d, "dup.json");
  writeFileSync(f, '{"schema_version":1,"schema_version":1,"services":{}}');
  assert.throws(() => loadIntegrations(f), /duplicate object key/);
  rmSync(d, { recursive: true, force: true });
});
