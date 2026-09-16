// Configuration model (spec section 4).
//
// Validates the parsed literal config entries against the supported key set,
// resolves the installer's own directories and the selected harness root, and
// validates configured paths and the optional informational code-host URL.
// Unknown VBCDX_AGENTS_* keys fail (to catch typos); unrelated keys are ignored
// without logging their values. VBCDX_AGENTS_WORKDIR is reserved and rejected
// when nonblank. Ambient environment variables are never used as defaults.

import { isAbsolute } from "node:path";
import { configError } from "../errors.js";

const HARNESS_ROOT_KEY = {
  dsh: "VBCDX_AGENTS_DSH_HOME",
  claude: "VBCDX_AGENTS_CLAUDE_CONFIG_DIR",
  codex: "VBCDX_AGENTS_CODEX_HOME",
  opencode: "VBCDX_AGENTS_OPENCODE_CONFIG_DIR",
};

export const LAUNCH_ENV_TRANSLATION = Object.freeze({
  VBCDX_AGENTS_DSH_HOME: "DSH_HOME",
  VBCDX_AGENTS_CLAUDE_CONFIG_DIR: "CLAUDE_CONFIG_DIR",
  VBCDX_AGENTS_CODEX_HOME: "CODEX_HOME",
  VBCDX_AGENTS_OPENCODE_CONFIG_DIR: "OPENCODE_CONFIG_DIR",
});

const SCALAR_KEYS = new Set([
  "VBCDX_AGENTS_BASE_DIR",
  "VBCDX_AGENTS_CREDENTIALS_DIR",
  "VBCDX_AGENTS_DSH_HOME",
  "VBCDX_AGENTS_CLAUDE_CONFIG_DIR",
  "VBCDX_AGENTS_CODEX_HOME",
  "VBCDX_AGENTS_OPENCODE_CONFIG_DIR",
  "VBCDX_AGENTS_CODE_HOST_URL",
  "VBCDX_AGENTS_INTEGRATIONS_FILE",
  "VBCDX_AGENTS_WORKDIR",
]);

const CREDENTIAL_KEY_RE = /^VBCDX_AGENTS_(USER|TOKEN|PASSWORD)_.+$/;
const PATH_KEYS = new Set([
  "VBCDX_AGENTS_BASE_DIR",
  "VBCDX_AGENTS_CREDENTIALS_DIR",
  "VBCDX_AGENTS_DSH_HOME",
  "VBCDX_AGENTS_CLAUDE_CONFIG_DIR",
  "VBCDX_AGENTS_CODEX_HOME",
  "VBCDX_AGENTS_OPENCODE_CONFIG_DIR",
  "VBCDX_AGENTS_INTEGRATIONS_FILE",
]);

export function validateAbsolutePath(key, value) {
  if (!isAbsolute(value)) throw configError(`${key} must be an absolute path.`);
  if (value.split("/").includes("..")) throw configError(`${key} must not contain '..'.`);
  return value;
}

/** Validate an absolute HTTP(S) URL without embedded credentials. */
export function validateServiceUrl(key, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw configError(`${key} must be an absolute HTTP(S) URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw configError(`${key} must use http or https.`);
  }
  if (url.username || url.password) {
    throw configError(`${key} must not embed credentials in the URL.`);
  }
  return value;
}

/**
 * Build the validated configuration for a run.
 *
 * @param {Map<string,string>} entries parsed literal config
 * @param {object} opts
 * @param {"dsh"|"claude"|"codex"|"opencode"} opts.harness
 * @param {"user"|"project"} opts.scope
 * @returns {object} config
 */
export function loadConfig(entries, { harness, scope }) {
  for (const key of entries.keys()) {
    if (!key.startsWith("VBCDX_AGENTS_")) continue; // unrelated key: ignored, value not logged
    if (SCALAR_KEYS.has(key)) continue;
    if (CREDENTIAL_KEY_RE.test(key)) continue;
    throw configError(`Unsupported configuration key ${key}. Check for a typo; unknown VBCDX_AGENTS_ keys are rejected.`);
  }

  for (const key of PATH_KEYS) {
    if (entries.has(key)) validateAbsolutePath(key, entries.get(key));
  }
  if (entries.has("VBCDX_AGENTS_CODE_HOST_URL")) {
    validateServiceUrl("VBCDX_AGENTS_CODE_HOST_URL", entries.get("VBCDX_AGENTS_CODE_HOST_URL"));
  }

  const workdir = entries.get("VBCDX_AGENTS_WORKDIR");
  if (typeof workdir === "string" && workdir.trim() !== "") {
    throw configError(
      "VBCDX_AGENTS_WORKDIR is reserved and unsupported; leave it blank. General workdir management is deferred.",
    );
  }

  const baseDir = entries.get("VBCDX_AGENTS_BASE_DIR");
  if (!baseDir) throw configError("VBCDX_AGENTS_BASE_DIR is required.");
  const credentialsDir = entries.get("VBCDX_AGENTS_CREDENTIALS_DIR");
  if (!credentialsDir) throw configError("VBCDX_AGENTS_CREDENTIALS_DIR is required.");

  // The selected harness root is required for DSH and for user scope; project
  // scope uses the containing worktree instead.
  let harnessRoot;
  const rootKey = HARNESS_ROOT_KEY[harness];
  if (harness === "dsh" || scope === "user") {
    harnessRoot = entries.get(rootKey);
    if (!harnessRoot) {
      throw configError(`${rootKey} is required for ${harness}${harness === "dsh" ? "" : ` ${scope} scope`}.`);
    }
  }

  return {
    harness,
    scope,
    baseDir,
    credentialsDir,
    harnessRoot,
    codeHostUrl: entries.get("VBCDX_AGENTS_CODE_HOST_URL") || null,
    integrationsFile: entries.get("VBCDX_AGENTS_INTEGRATIONS_FILE") || null,
    // The launch-environment translation the operator must apply for user scope.
    launchEnv:
      scope === "user" && rootKey && entries.has(rootKey)
        ? { [LAUNCH_ENV_TRANSLATION[rootKey]]: entries.get(rootKey) }
        : {},
  };
}
