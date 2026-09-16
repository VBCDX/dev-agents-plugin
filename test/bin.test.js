import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "vbcdx-dev-agents.js");

function run(args, opts = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", ...opts });
}

test("--version prints the version and exits 0", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("--help exits 0; no command exits 2", () => {
  assert.equal(run(["--help"]).status, 0);
  assert.equal(run([]).status, 2);
  assert.equal(run(["bogus"]).status, 2);
});

test("missing --harness exits 2 (config)", () => {
  const r = run(["init", "--env=/tmp/x"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--harness is required/);
});

test("a full credential-free install exits 0 and reports actions", () => {
  const root = mkdtempSync(join(tmpdir(), "vbcdx-bin-"));
  const cfg = join(root, "c.env");
  writeFileSync(cfg, [
    `VBCDX_AGENTS_BASE_DIR=${root}/state`,
    `VBCDX_AGENTS_CREDENTIALS_DIR=${root}/creds`,
    `VBCDX_AGENTS_CLAUDE_CONFIG_DIR=${root}/claude`,
  ].join("\n") + "\n");
  const r = run(["init", "--harness=claude", `--env=${cfg}`, "--agents=code-agent,pm-agent"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /definition code-agent: install/);
  rmSync(root, { recursive: true, force: true });
});

test("--quiet suppresses routine progress but not warnings", () => {
  const root = mkdtempSync(join(tmpdir(), "vbcdx-bin-"));
  const cfg = join(root, "c.env");
  writeFileSync(cfg, [
    `VBCDX_AGENTS_BASE_DIR=${root}/state`,
    `VBCDX_AGENTS_CREDENTIALS_DIR=${root}/creds`,
    `VBCDX_AGENTS_CLAUDE_CONFIG_DIR=${root}/claude`,
    `VBCDX_AGENTS_USER_LEGACY_BOT=u`,
    `VBCDX_AGENTS_TOKEN_LEGACY_BOT=t`,
  ].join("\n") + "\n");
  const r = run(["init", "--harness=claude", `--env=${cfg}`, "--quiet"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), ""); // routine progress suppressed
  assert.match(r.stderr, /warning:.*legacy-bot/); // warning not suppressed
  rmSync(root, { recursive: true, force: true });
});
