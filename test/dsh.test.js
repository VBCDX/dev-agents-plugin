import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init, materializeFromPlan } from "../src/index.js";
import { EXIT } from "../src/errors.js";

// Exercises the DSH harness path end to end WITHOUT a live DSH: init stages a
// versioned plan plus rendered assets (executor), and the boot-time materializer
// writes exactly the recorded presets through the shared safe writer. The live
// mount on a real DSH version is a separate release gate (issue #3, AC 7/11);
// everything provable offline — selected-only staging, digest-verified boot,
// idempotent repeated boot, and one-time (non-perpetual) force — is proved here.

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "vbcdx-dsh-"));
  const cfg = join(root, "config.env");
  writeFileSync(cfg, [
    `VBCDX_AGENTS_BASE_DIR=${root}/state`,
    `VBCDX_AGENTS_CREDENTIALS_DIR=${root}/creds`,
    `VBCDX_AGENTS_DSH_HOME=${root}/dsh`,
    "",
  ].join("\n"));
  return { root, cfg, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

const planPathFor = (root, profile = "web") =>
  join(root, "state", "installations", "dsh", profile, "plan.json");
const presetFile = (root, id, name) =>
  join(root, "dsh", ".agent-presets", id, name);

test("DSH init stages a versioned plan and rendered assets for the selection only", () => {
  const e = scratch();
  const report = init(["--harness=dsh", "--env=" + e.cfg, "--agents=code-agent,crazy-ivan"]);
  assert.equal(report.dsh.action, "staged");
  assert.equal(report.dsh.boot, "pending"); // init never boots DSH
  const plan = JSON.parse(readFileSync(planPathFor(e.root), "utf8"));
  assert.equal(plan.schema_version, 1);
  assert.equal(plan.profile, "web");
  assert.deepEqual(plan.selected.sort(), ["code-agent", "crazy-ivan"]);
  // Two files per selected role are staged; nothing for unselected roles.
  const staged = join(e.root, "state", "installations", "dsh", "web", "assets");
  assert.ok(existsSync(join(staged, "code-agent", "preset.yml")));
  assert.ok(existsSync(join(staged, "code-agent", "agent.cordis.yml")));
  assert.ok(existsSync(join(staged, "crazy-ivan", "agent.cordis.yml")));
  assert.equal(existsSync(join(staged, "pm-agent")), false);
  // Nothing was materialized into the DSH home yet.
  assert.equal(existsSync(join(e.root, "dsh", ".agent-presets")), false);
  e.cleanup();
});

test("boot materializer writes exactly the recorded presets and is idempotent", () => {
  const e = scratch();
  init(["--harness=dsh", "--env=" + e.cfg, "--agents=code-agent,crazy-ivan"]);
  const planPath = planPathFor(e.root);

  const first = materializeFromPlan(planPath);
  assert.equal(first.files.length, 4); // 2 files x 2 roles
  assert.ok(first.files.every((f) => f.action === "install"));
  assert.ok(existsSync(presetFile(e.root, "code-agent", "preset.yml")));
  assert.ok(existsSync(presetFile(e.root, "crazy-ivan", "agent.cordis.yml")));
  // Unselected roles are never materialized.
  assert.equal(existsSync(join(e.root, "dsh", ".agent-presets", "pm-agent")), false);

  // A second boot with no changes is a pure no-op — no perpetual rewriting.
  const second = materializeFromPlan(planPath);
  assert.ok(second.files.every((f) => f.action === "noop"));
  e.cleanup();
});

test("boot materializer refuses a staged asset that no longer matches the plan digest", () => {
  const e = scratch();
  init(["--harness=dsh", "--env=" + e.cfg, "--agents=code-agent"]);
  const planPath = planPathFor(e.root);
  const stagedAsset = join(e.root, "state", "installations", "dsh", "web", "assets", "code-agent", "preset.yml");
  writeFileSync(stagedAsset, "tampered: true\n"); // swap the staged content
  assert.throws(() => materializeFromPlan(planPath), (err) => {
    assert.equal(err.code, EXIT.FILESYSTEM);
    assert.match(err.message, /does not match the plan digest/);
    return true;
  });
  e.cleanup();
});

test("force is consumed once at boot and does not perpetually overwrite later edits", () => {
  const e = scratch();
  init(["--harness=dsh", "--env=" + e.cfg, "--agents=code-agent", "--force"]);
  const planPath = planPathFor(e.root);
  assert.equal(JSON.parse(readFileSync(planPath, "utf8")).force, true);

  // First boot applies with force, then clears it so a rerun cannot keep
  // clobbering operator edits.
  materializeFromPlan(planPath);
  assert.equal(JSON.parse(readFileSync(planPath, "utf8")).force, false);

  // Operator edits a materialized preset; the next boot (force now false) must
  // treat it as a conflict rather than silently overwriting.
  const target = presetFile(e.root, "code-agent", "preset.yml");
  writeFileSync(target, "name: hand edited\n");
  assert.throws(() => materializeFromPlan(planPath), (err) => {
    assert.equal(err.code, EXIT.CONFLICT);
    return true;
  });
  e.cleanup();
});

test("materialized presets are non-secret 0644 files", () => {
  const e = scratch();
  init(["--harness=dsh", "--env=" + e.cfg, "--agents=code-agent"]);
  materializeFromPlan(planPathFor(e.root));
  assert.equal(statSync(presetFile(e.root, "code-agent", "preset.yml")).mode & 0o777, 0o644);
  e.cleanup();
});
