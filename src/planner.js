// Plan construction (spec sections 3–8). Pure: it validates everything and
// computes every intended effect, but performs no writes, takes no locks, and
// runs no child process. The executor consumes the plan; --dry-run stops here
// and reports it. Validation runs in first-failed-phase order so the exit code
// reflects the earliest failure.

import { join, dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { getRole } from "./roles/index.js";
import { loadConfig } from "./config/config.js";
import { loadIntegrations, SERVICE_CONTRACT } from "./config/integrations.js";
import { collectCredentialTriples, classifyTriple, serializeCredentialFile } from "./credentials/writer.js";
import { renderFlat, renderDsh, resolveHarnessDir } from "./renderers/index.js";
import { sha256 } from "./fs/safe-writer.js";
import { parseEnvText } from "./config/env-parser.js";
import { configError, credentialError, conflictError, filesystemError } from "./errors.js";
import { isCanonicalId } from "./roles/registry.js";

/** Find the top level of the containing Git worktree, or null. */
export function findWorktreeRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Service-specific required fields for an externally provisioned credential
// file (spec 6.1): forgejo needs USER + TOKEN/PASSWORD; coolify needs TOKEN.
function externalCredentialOk(absPath, role, service) {
  const has = (v) => typeof v === "string" && v.trim() !== "";
  let raw;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return { ok: false, exit: 3, reason: "credential_missing" };
    return { ok: false, exit: 4, reason: "credential_unreadable" };
  }
  let parsed;
  try {
    parsed = parseEnvText(raw, absPath);
  } catch {
    return { ok: false, exit: 3, reason: "credential_malformed" };
  }
  if (parsed.get("VBCDX_AGENTS_ROLE") !== role) return { ok: false, exit: 3, reason: "role_mismatch" };
  if (service === "coolify") {
    if (!has(parsed.get("VBCDX_AGENTS_TOKEN"))) return { ok: false, exit: 3, reason: "credential_key_missing" };
  } else {
    if (!has(parsed.get("VBCDX_AGENTS_USER")) || !(has(parsed.get("VBCDX_AGENTS_TOKEN")) || has(parsed.get("VBCDX_AGENTS_PASSWORD")))) {
      return { ok: false, exit: 3, reason: "credential_key_missing" };
    }
  }
  return { ok: true };
}

/**
 * Build the installation plan.
 * @param {object} args parsed init options (from parseInitArgs)
 * @param {Map<string,string>} entries parsed literal config
 * @param {object} [io] { cwd }
 */
export function buildPlan(args, entries, { cwd = process.cwd() } = {}) {
  const { harness, scope, profile, force, dryRun, agents, agentsExplicit } = args;

  // Phase: CLI/config (exit 2).
  const config = loadConfig(entries, { harness, scope });
  const roles = agents.map((id) => {
    const r = getRole(id);
    if (!r) throw configError(`Unknown agent ID in selection: ${id}.`);
    return r;
  });
  const selectedSet = new Set(agents);

  let worktreeRoot = null;
  if (scope === "project") {
    worktreeRoot = findWorktreeRoot(cwd);
    if (!worktreeRoot) throw configError("Project scope requires running inside a Git worktree; none was found.");
  }

  // Integrations (structure/manifest: exit 2/5).
  let integrations = null;
  if (config.integrationsFile) {
    integrations = loadIntegrations(config.integrationsFile);
  }

  // Phase: credentials (exit 3). Collect triples and decide per-role ops.
  const triples = collectCredentialTriples(entries);
  const credentialOps = [];
  const warnings = [];
  const plannedCredPaths = new Map(); // role -> planned path (write or retain)

  for (const [role, triple] of triples) {
    const known = isCanonicalId(role);
    const cls = classifyTriple(triple);
    const isSelected = selectedSet.has(role);

    if (known && isSelected) {
      if (cls === "incomplete") {
        throw credentialError(`Credential triple for ${role} is incomplete: set USER and at least one of TOKEN/PASSWORD, or leave all three blank to disable.`);
      }
      if (cls === "complete") {
        const path = join(config.credentialsDir, `${role}.env`);
        credentialOps.push({ role, path, triple: { ...triple, role } });
        plannedCredPaths.set(role, path);
      }
      // disabled -> no file
      continue;
    }
    if (known && !isSelected) continue; // unselected known role: excluded

    // Unknown role.
    if (agentsExplicit) continue; // explicit selection excludes unknown triples
    if (cls === "disabled") continue;
    if (cls === "incomplete") {
      throw credentialError(`Credential triple for unknown role ${role} is incomplete; fix it or remove it (possible typo of a canonical agent ID).`);
    }
    // complete unknown triple under default-all: write with a warning.
    const path = join(config.credentialsDir, `${role}.env`);
    credentialOps.push({ role, path, triple: { ...triple, role }, unknown: true });
    plannedCredPaths.set(role, path);
    warnings.push(`Credential file for unknown role ${role} will be written, but no corresponding agent is installed.`);
  }

  // Cross-check integration credential mappings for selected roles.
  if (integrations) {
    for (const [service, svc] of Object.entries(integrations.services)) {
      for (const [role, credPath] of Object.entries(svc.credentials)) {
        if (!selectedSet.has(role)) continue; // completeness only for the selection
        const plannedPath = plannedCredPaths.get(role);
        if (plannedPath && plannedPath === credPath) continue; // this installer plans to create it
        // Otherwise it must be an existing, valid, separately provisioned file.
        const check = externalCredentialOk(credPath, role, service);
        if (!check.ok) {
          const msg = `Integration ${service} maps ${role} to ${credPath}, which is ${check.reason}. It must be a valid, separately provisioned credential file.`;
          if (check.exit === 4) throw filesystemError(msg);
          throw credentialError(msg);
        }
      }
    }
  }

  // Phase: generated definitions (rendered content + destinations).
  const generated = [];
  const dsh = harness === "dsh" ? buildDshStaging(config, profile, roles, integrations, force) : null;
  if (harness !== "dsh") {
    const dir = resolveHarnessDir(harness, scope, { harnessRoot: config.harnessRoot, worktreeRoot });
    for (const role of roles) {
      const out = renderFlat(harness, role, { integrations });
      const destination = join(dir, out.filename);
      generated.push({ role: role.id, harness, destination, content: out.content, digest: sha256(Buffer.from(out.content)), mode: out.mode });
    }
  }

  return {
    harness, scope, profile, force, dryRun,
    baseDir: config.baseDir,
    credentialsDir: config.credentialsDir,
    manifestPath: join(config.baseDir, "manifests", "installation.json"),
    roles: agents,
    generated,
    dsh,
    credentialOps,
    launchEnv: config.launchEnv,
    integrations: integrations ? Object.keys(integrations.services) : [],
    warnings,
  };
}

// Stage rendered DSH assets and a versioned nonsecret plan under
// <BASE_DIR>/installations/dsh/<profile>/ (spec section 8). Materialization
// targets under <DSH_HOME>/.agent-presets/<id>/ are recorded in the plan; init
// never boots DSH.
function buildDshStaging(config, profile, roles, integrations, force) {
  const stagingDir = join(config.baseDir, "installations", "dsh", profile);
  const dshHome = config.harnessRoot;
  const presetsRoot = join(dshHome, ".agent-presets");
  const assets = [];
  for (const role of roles) {
    const { files } = renderDsh(role, { integrations });
    const staged = files.map((f) => ({
      name: f.name,
      stagedPath: join(stagingDir, "assets", role.id, f.name),
      materializeTarget: join(presetsRoot, role.id, f.name),
      content: f.content,
      digest: sha256(Buffer.from(f.content)),
      mode: f.mode,
    }));
    assets.push({ role: role.id, files: staged });
  }
  const plan = {
    schema_version: 1,
    harness: "dsh",
    profile,
    dsh_home: dshHome,
    presets_root: presetsRoot,
    force: Boolean(force),
    selected: roles.map((r) => r.id),
    assets: assets.map((a) => ({
      role: a.role,
      files: a.files.map((f) => ({ name: f.name, materialize_target: f.materializeTarget, digest: f.digest, mode: f.mode })),
    })),
    pending: "materialize-on-boot",
  };
  return { stagingDir, dshHome, presetsRoot, planPath: join(stagingDir, "plan.json"), assets, plan };
}
