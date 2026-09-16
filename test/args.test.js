import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInitArgs, validateProfile } from "../src/cli/args.js";

test("requires --harness and --env", () => {
  assert.throws(() => parseInitArgs(["--env=/x"]), /--harness is required/);
  assert.throws(() => parseInitArgs(["--harness=claude"]), /--env is required/);
});

test("--env must be absolute", () => {
  assert.throws(() => parseInitArgs(["--harness=claude", "--env=rel/path"]), /absolute path/);
});

test("defaults: user scope, all sixteen agents", () => {
  const o = parseInitArgs(["--harness=claude", "--env=/c"]);
  assert.equal(o.scope, "user");
  assert.equal(o.agents.length, 16);
  assert.equal(o.agentsExplicit, false);
});

test("--agents dedupes, preserves order, rejects unknown and source aliases", () => {
  const o = parseInitArgs(["--harness=claude", "--env=/c", "--agents=pm-agent, code-agent ,pm-agent"]);
  assert.deepEqual(o.agents, ["pm-agent", "code-agent"]);
  assert.equal(o.agentsExplicit, true);
  assert.throws(() => parseInitArgs(["--harness=claude", "--env=/c", "--agents=nope"]), /unknown agent ID/);
  assert.throws(() => parseInitArgs(["--harness=claude", "--env=/c", "--agents=all-tools"]), /source alias/);
  assert.throws(() => parseInitArgs(["--harness=claude", "--env=/c", "--agents=code-agent,"]), /empty item/);
});

test("DSH rejects --scope, defaults profile web; others reject --profile", () => {
  assert.throws(() => parseInitArgs(["--harness=dsh", "--env=/c", "--scope=user"]), /does not accept an explicit --scope/);
  const dsh = parseInitArgs(["--harness=dsh", "--env=/c"]);
  assert.equal(dsh.scope, "dsh");
  assert.equal(dsh.profile, "web");
  assert.throws(() => parseInitArgs(["--harness=claude", "--env=/c", "--profile=web"]), /only valid for the dsh/);
});

test("rejects local/global as scopes and unknown options", () => {
  assert.throws(() => parseInitArgs(["--harness=claude", "--env=/c", "--scope=local"]), /Unsupported --scope/);
  assert.throws(() => parseInitArgs(["--harness=claude", "--env=/c", "--frobnicate"]), /Unknown or malformed option/);
});

test("profile validation rejects traversal and separators", () => {
  assert.throws(() => validateProfile("../x"), /Invalid --profile/);
  assert.throws(() => validateProfile("a/b"), /Invalid --profile/);
  assert.equal(validateProfile("web"), "web");
});

test("flags parse", () => {
  const o = parseInitArgs(["--harness=claude", "--env=/c", "--force", "--dry-run", "--quiet"]);
  assert.equal(o.force, true);
  assert.equal(o.dryRun, true);
  assert.equal(o.quiet, true);
});
