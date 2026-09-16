// DSH boot-time materializer (spec sections 8 and 9).
//
// At the operator-controlled DSH boot, this reads the versioned plan staged by
// `init` and materializes exactly the recorded preset assets into
// <DSH_HOME>/.agent-presets/<id>/ using the shared safe writer and the same
// ownership rules as every other managed file. It never boots or restarts DSH,
// never recursively removes a preset directory or user files, and never touches
// an unselected agent. Force from the pending operation is consumed on the
// first boot and then cleared, so later boots do not perpetually overwrite.
//
// A readback after boot (via the returned report and the presets manifest)
// distinguishes package registration from actual preset creation.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { readManifest, writeManifest, applyGenerated } from "../fs/manifest.js";
import { ensureDir, acquireLocks, atomicWrite, sha256 } from "../fs/safe-writer.js";
import { filesystemError } from "../errors.js";

/**
 * Materialize the presets recorded in a staged plan.json.
 * @param {string} planPath absolute path to the staged plan.json
 * @returns {object} report of per-file actions
 */
export function materializeFromPlan(planPath) {
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  if (plan.schema_version !== 1 || plan.harness !== "dsh") {
    throw filesystemError(`Staged DSH plan at ${planPath} is unsupported or corrupt.`);
  }
  const stagingAssetsDir = join(dirname(planPath), "assets");
  const manifestPath = join(plan.presets_root, ".dsh-agents", "manifest.json");
  const force = Boolean(plan.force);

  const targets = [manifestPath];
  for (const a of plan.assets) for (const f of a.files) targets.push(f.materialize_target);
  const release = acquireLocks(targets);
  const report = { profile: plan.profile, files: [], force };
  try {
    ensureDir(dirname(manifestPath), 0o755);
    const manifest = readManifest(manifestPath, "boot");
    for (const a of plan.assets) {
      for (const f of a.files) {
        const stagedFile = join(stagingAssetsDir, a.role, f.name);
        const content = readFileSync(stagedFile, "utf8");
        const digest = sha256(Buffer.from(content));
        if (digest !== f.digest) {
          throw filesystemError(`Staged asset ${stagedFile} does not match the plan digest; refusing to materialize a tampered asset.`);
        }
        ensureDir(dirname(f.materialize_target));
        const res = applyGenerated({
          absPath: f.materialize_target, content, digest, mode: f.mode,
          recordedEntry: manifest.files[f.materialize_target], force,
        });
        if (res.action !== "noop") {
          manifest.files[f.materialize_target] = {
            digest: res.digest, mode: f.mode, role: a.role, harness: "dsh",
            written_at: new Date().toISOString(),
          };
        }
        report.files.push({ role: a.role, target: f.materialize_target, action: res.action });
      }
    }
    writeManifest(manifestPath, manifest);
  } finally {
    release();
  }

  // Consume force so a later boot does not perpetually overwrite user edits.
  if (force) {
    atomicWrite(planPath, JSON.stringify({ ...plan, force: false, materialized_at: new Date().toISOString() }, null, 2) + "\n", { mode: 0o644 });
  }
  return report;
}
