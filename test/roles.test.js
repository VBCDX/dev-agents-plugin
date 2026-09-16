import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_IDS,
  SOURCE_TO_CANONICAL,
  idToSuffix,
  normalizeSuffix,
  SUFFIX_TO_ID,
} from "../src/roles/registry.js";
import { allRoles, getRole } from "../src/roles/index.js";

test("there are exactly sixteen canonical roles", () => {
  assert.equal(CANONICAL_IDS.length, 16);
  assert.equal(new Set(CANONICAL_IDS).size, 16);
});

test("every source preset maps to a canonical ID and covers all sixteen", () => {
  const mapped = new Set(Object.values(SOURCE_TO_CANONICAL));
  assert.equal(mapped.size, 16);
  for (const id of CANONICAL_IDS) assert.ok(mapped.has(id), `missing mapping for ${id}`);
  assert.equal(SOURCE_TO_CANONICAL["all-tools"], "all-in-one-dev-agent");
  assert.equal(SOURCE_TO_CANONICAL["reward-hack-auditor"], "reward-hack-auditor-agent");
});

test("suffix round-trips with the canonical ID", () => {
  for (const id of CANONICAL_IDS) {
    const suffix = idToSuffix(id);
    assert.equal(normalizeSuffix(suffix), id, `suffix ${suffix} must normalize back to ${id}`);
    assert.equal(SUFFIX_TO_ID[suffix], id);
  }
  // The installer suffix is CODE_AGENT, never the account selector CODER_AGENT.
  assert.equal(idToSuffix("code-agent"), "CODE_AGENT");
  assert.equal(SUFFIX_TO_ID["CODER_AGENT"], undefined);
});

test("every role loads with a prompt and a valid descriptor", () => {
  const roles = allRoles();
  assert.equal(roles.size, 16);
  for (const id of CANONICAL_IDS) {
    const role = getRole(id);
    assert.ok(role, `role ${id} loads`);
    assert.ok(role.prompt.length > 0, `role ${id} has a prompt`);
    const d = role.descriptor;
    assert.equal(d.schema_version, 1);
    assert.equal(d.id, id);
    assert.equal(d.credential_suffix, idToSuffix(id));
    assert.ok(d.policy && typeof d.policy.kind === "string");
    assert.ok(["read-write", "read-only"].includes(d.local_capabilities.filesystem));
    assert.ok(typeof d.local_capabilities.shell === "boolean");
    assert.ok(["all", "primary"].includes(d.opencode_mode));
  }
});

test("prompts carry no forbidden infrastructure assumptions", () => {
  const forbidden = [/CODE_HOST_/, /\$DSH_HOME/, /curl\s+-/, /-sSk\b/, /\/api\/v1\/repos/, /NODE_TLS_REJECT/];
  for (const id of CANONICAL_IDS) {
    const { prompt } = getRole(id);
    for (const re of forbidden) {
      assert.doesNotMatch(prompt, re, `role ${id} prompt must not contain ${re}`);
    }
  }
});

test("no credential values are embedded and prompts are model routing free", () => {
  for (const id of CANONICAL_IDS) {
    const { prompt } = getRole(id);
    assert.doesNotMatch(prompt, /password\s*[:=]\s*\S/i);
  }
});

test("PM and all-in-one use OpenCode primary mode; others use all", () => {
  assert.equal(getRole("pm-agent").descriptor.opencode_mode, "primary");
  assert.equal(getRole("all-in-one-dev-agent").descriptor.opencode_mode, "primary");
  assert.equal(getRole("code-agent").descriptor.opencode_mode, "all");
});

test("inspection roles carry no merge authority and record advisory read-only", () => {
  for (const id of ["review-agent", "crazy-ivan", "reward-hack-auditor-agent", "security-agent"]) {
    const d = getRole(id).descriptor;
    assert.equal(d.policy.may_merge, false, `${id} must not merge`);
    assert.equal(d.policy.source_read_only, true, `${id} is source read-only`);
    assert.ok(!(d.remote_capabilities.forgejo || []).includes("merge_pull_request"));
  }
  // PM is the merge authority.
  assert.equal(getRole("pm-agent").descriptor.policy.may_merge, true);
  assert.ok(getRole("pm-agent").descriptor.remote_capabilities.forgejo.includes("merge_pull_request"));
  // Code agent never reviews.
  assert.ok(!getRole("code-agent").descriptor.remote_capabilities.forgejo.includes("create_review"));
});

test("reward-hack auditor records the audit gate as an unavailable external dependency", () => {
  const d = getRole("reward-hack-auditor-agent").descriptor;
  assert.ok(Array.isArray(d.external_dependencies));
  assert.equal(d.external_dependencies[0].status, "unavailable");
});
