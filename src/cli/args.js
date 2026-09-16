// CLI argument parsing for `init` (spec section 3).
//
// No credential or endpoint value is ever accepted on the command line — only
// --harness, --env (an absolute path), --agents, --scope, --profile, and the
// boolean flags. Unknown options and values are rejected (exit 2).

import { isAbsolute } from "node:path";
import { CANONICAL_IDS, HARNESSES, isCanonicalId, SOURCE_TO_CANONICAL } from "../roles/registry.js";
import { configError } from "../errors.js";

const SOURCE_ALIASES = new Set(
  Object.keys(SOURCE_TO_CANONICAL).filter((s) => SOURCE_TO_CANONICAL[s] !== s),
);
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function parseSelection(raw) {
  const items = raw.split(",").map((s) => s.trim());
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (item === "") throw configError("--agents contains an empty item.");
    if (SOURCE_ALIASES.has(item)) {
      throw configError(`--agents does not accept the source alias ${item}; use its canonical ID ${SOURCE_TO_CANONICAL[item]}.`);
    }
    if (!isCanonicalId(item)) throw configError(`--agents has an unknown agent ID: ${item}.`);
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  if (out.length === 0) throw configError("--agents selected no agents.");
  return out;
}

export function validateProfile(profile) {
  if (profile === "." || profile === ".." || !PROFILE_RE.test(profile) || profile.length > 64) {
    throw configError(`Invalid --profile ${JSON.stringify(profile)}: use a simple name without separators or traversal.`);
  }
  return profile;
}

/**
 * Parse the argv tail after the `init` subcommand.
 * @returns {object} options
 */
export function parseInitArgs(argv) {
  const opts = { agents: null, scope: null, profile: null, force: false, dryRun: false, quiet: false, harness: null, env: null };
  for (const arg of argv) {
    let key = arg;
    let value = null;
    if (arg.startsWith("--") && arg.includes("=")) {
      const eq = arg.indexOf("=");
      key = arg.slice(0, eq);
      value = arg.slice(eq + 1);
    }
    switch (key) {
      case "--harness": opts.harness = requireValue(key, value); break;
      case "--env": opts.env = requireValue(key, value); break;
      case "--agents": opts.agents = parseSelection(requireValue(key, value)); break;
      case "--scope": opts.scope = requireValue(key, value); break;
      case "--profile": opts.profile = validateProfile(requireValue(key, value)); break;
      case "--force": opts.force = true; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--quiet": opts.quiet = true; break;
      default:
        throw configError(`Unknown or malformed option: ${arg}.`);
    }
  }

  if (!opts.harness) throw configError("--harness is required (dsh|claude|codex|opencode).");
  if (!HARNESSES.includes(opts.harness)) throw configError(`Unsupported --harness: ${opts.harness}.`);
  if (!opts.env) throw configError("--env is required (an absolute path to the literal config file).");
  if (!isAbsolute(opts.env)) throw configError("--env must be an absolute path.");

  // Scope rules.
  if (opts.harness === "dsh") {
    if (opts.scope !== null) throw configError("DSH does not accept an explicit --scope.");
    opts.scope = "dsh";
  } else {
    if (opts.scope === null) opts.scope = "user";
    if (!["user", "project"].includes(opts.scope)) {
      throw configError(`Unsupported --scope: ${opts.scope}. Use user or project (local/global are not scopes).`);
    }
  }

  // Profile rules.
  if (opts.harness === "dsh") {
    if (opts.profile === null) opts.profile = "web";
  } else if (opts.profile !== null) {
    throw configError("--profile is only valid for the dsh harness.");
  }

  opts.agentsExplicit = opts.agents !== null;
  opts.agents = opts.agents || [...CANONICAL_IDS];
  return opts;
}

function requireValue(key, value) {
  if (value === null || value === undefined || value === "") {
    throw configError(`${key} requires a value (use ${key}=<value>).`);
  }
  return value;
}
