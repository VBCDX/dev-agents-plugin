// Plan executor (spec sections 8, 9, 10). Applies a plan built by planner.js:
// acquires exclusive locks in stable order, preflights, writes generated
// definitions through the manifest ownership classifier, writes credential
// files through the secret-safe writer, stages DSH assets and its versioned
// plan, and (for a real DSH install) attempts native package registration.
// Multi-file operations are not globally transactional; the returned report
// lists exactly what changed so a partial failure can be retried safely.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { readManifest, writeManifest, applyGenerated } from "./fs/manifest.js";
import { ensureDir, acquireLocks, atomicWrite } from "./fs/safe-writer.js";
import { writeCredentialFile } from "./credentials/writer.js";
import { subprocessError } from "./errors.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readPkgVersion() {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

/**
 * Execute a plan.
 * @param {object} plan from buildPlan
 * @returns {object} report of actions taken (or planned, when dryRun)
 */
export function executePlan(plan) {
  const pkgVersion = readPkgVersion();
  const report = {
    dryRun: plan.dryRun,
    harness: plan.harness,
    scope: plan.scope,
    profile: plan.profile,
    generated: [],
    credentials: [],
    dsh: null,
    launchEnv: plan.launchEnv,
    integrations: plan.integrations,
    warnings: [...plan.warnings],
  };

  if (plan.dryRun) {
    // Read-only: describe planned actions, take no lock, write nothing.
    for (const g of plan.generated) report.generated.push({ role: g.role, destination: g.destination, action: "planned" });
    for (const c of plan.credentialOps) report.credentials.push({ role: c.role, path: c.path, action: "planned" });
    if (plan.dsh) {
      report.dsh = { profile: plan.profile, stagingDir: plan.dsh.stagingDir, planPath: plan.dsh.planPath, action: "planned", registration: "planned", boot: "pending" };
    }
    return report;
  }

  // Pre-create the private credentials dir at 0700 so later lock/dir creation
  // never downgrades it, and secret writes see a compliant parent.
  if (plan.credentialOps.length) ensureDir(plan.credentialsDir, 0o700);

  // Gather every destination to lock, in a stable order.
  const lockTargets = [
    plan.manifestPath,
    ...plan.generated.map((g) => g.destination),
    ...plan.credentialOps.map((c) => c.path),
  ];
  if (plan.dsh) {
    lockTargets.push(plan.dsh.planPath);
    for (const a of plan.dsh.assets) for (const f of a.files) lockTargets.push(f.stagedPath);
  }
  const release = acquireLocks(lockTargets);
  try {
    ensureDir(dirname(plan.manifestPath));
    const manifest = readManifest(plan.manifestPath, pkgVersion);

    // Generated definitions (flat harnesses).
    for (const g of plan.generated) {
      ensureDir(dirname(g.destination));
      const res = applyGenerated({
        absPath: g.destination,
        content: g.content,
        digest: g.digest,
        mode: g.mode,
        recordedEntry: manifest.files[g.destination],
        force: plan.force,
      });
      if (res.action !== "noop") {
        manifest.files[g.destination] = {
          digest: res.digest, mode: g.mode, role: g.role, harness: g.harness,
          package_version: pkgVersion, written_at: new Date().toISOString(),
        };
      }
      report.generated.push({ role: g.role, destination: g.destination, action: res.action });
    }

    // DSH staging + native registration.
    if (plan.dsh) {
      report.dsh = executeDsh(plan.dsh, manifest, pkgVersion, plan.force);
    }

    // Credential files (never recorded in the installation manifest).
    for (const c of plan.credentialOps) {
      const res = writeCredentialFile({ credentialsDir: plan.credentialsDir, triple: c.triple, force: plan.force });
      report.credentials.push({ role: c.role, path: res.path, action: res.action, unknown: Boolean(c.unknown) });
    }

    manifest.package_version = pkgVersion;
    writeManifest(plan.manifestPath, manifest);
  } finally {
    release();
  }
  return report;
}

function executeDsh(dsh, manifest, pkgVersion, force) {
  // Stage rendered assets and the versioned plan; these are package-owned and
  // tracked in the manifest so updates and repairs follow the same rules.
  for (const a of dsh.assets) {
    for (const f of a.files) {
      ensureDir(dirname(f.stagedPath));
      const res = applyGenerated({
        absPath: f.stagedPath, content: f.content, digest: f.digest, mode: f.mode,
        recordedEntry: manifest.files[f.stagedPath], force,
      });
      if (res.action !== "noop") {
        manifest.files[f.stagedPath] = {
          digest: res.digest, mode: f.mode, role: a.role, harness: "dsh-staged",
          package_version: pkgVersion, written_at: new Date().toISOString(),
        };
      }
    }
  }
  atomicWrite(dsh.planPath, JSON.stringify(dsh.plan, null, 2) + "\n", { mode: 0o644 });

  // Attempt native package registration. init never boots DSH; if the dsh CLI
  // is unavailable the adapter reports the registration as pending rather than
  // claiming success by copying files around.
  const registration = registerDshPackage(dsh);
  return {
    profile: dsh.plan.profile,
    stagingDir: dsh.stagingDir,
    planPath: dsh.planPath,
    action: "staged",
    registration: registration.status,
    registrationDetail: registration.detail,
    boot: "pending",
  };
}

function registerDshPackage(dsh) {
  let probe;
  try {
    probe = spawnSync("dsh", ["--version"], { encoding: "utf8", timeout: 15000 });
  } catch {
    probe = { error: new Error("spawn failed") };
  }
  if (probe.error || probe.status !== 0) {
    return { status: "unavailable", detail: "The dsh CLI is not available; staged assets and plan are ready for a later operator-run registration and boot." };
  }
  const res = spawnSync("dsh", ["plugin", "--profile", dsh.plan.profile, "add", PACKAGE_ROOT], {
    encoding: "utf8", timeout: 120000, env: { ...process.env, DSH_HOME: dsh.dshHome },
  });
  if (res.error) throw subprocessError(`DSH registration failed to start: ${res.error.code || res.error.message}.`);
  if (res.status !== 0) throw subprocessError(`DSH registration exited ${res.status}. Staged plan is at ${dsh.planPath}.`);
  return { status: "registered", detail: "Native package registered; materialization happens on the next operator-controlled DSH boot." };
}
