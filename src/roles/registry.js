// Canonical agent registry (spec section 2).
//
// Sixteen canonical agent IDs, their credential suffixes, and the mapping
// from the source dsh-agents preset directory name to the canonical ID.
// The credential suffix is exactly the canonical ID uppercased with hyphens
// replaced by underscores; normalizing a suffix (lowercase, underscores ->
// hyphens) recovers the canonical ID. This relationship is asserted in tests
// so the two tables can never silently drift.
//
// Note the deliberate distinction called out by the spec: the installer role
// suffix is CODE_AGENT, never the infrastructure account selector CODER_AGENT.

/** @type {ReadonlyArray<string>} canonical agent IDs, stable order */
export const CANONICAL_IDS = Object.freeze([
  "all-in-one-dev-agent",
  "code-agent",
  "copywriter-content",
  "copywriter-marketing",
  "crazy-ivan",
  "designer-agent",
  "devops-agent",
  "instructional-designer-agent",
  "market-research-agent",
  "pm-agent",
  "qa-agent",
  "review-agent",
  "reward-hack-auditor-agent",
  "security-agent",
  "user-research-agent",
  "video-creator",
]);

// Source preset directory name -> canonical ID. Only two names change; the
// rest are identical. Source aliases are NOT accepted by --agents.
export const SOURCE_TO_CANONICAL = Object.freeze({
  "all-tools": "all-in-one-dev-agent",
  "reward-hack-auditor": "reward-hack-auditor-agent",
  "code-agent": "code-agent",
  "copywriter-content": "copywriter-content",
  "copywriter-marketing": "copywriter-marketing",
  "crazy-ivan": "crazy-ivan",
  "designer-agent": "designer-agent",
  "devops-agent": "devops-agent",
  "instructional-designer-agent": "instructional-designer-agent",
  "market-research-agent": "market-research-agent",
  "pm-agent": "pm-agent",
  "qa-agent": "qa-agent",
  "review-agent": "review-agent",
  "security-agent": "security-agent",
  "user-research-agent": "user-research-agent",
  "video-creator": "video-creator",
});

export const HARNESSES = Object.freeze(["dsh", "claude", "codex", "opencode"]);

/** Convert a canonical ID to its credential suffix. */
export function idToSuffix(id) {
  return id.toUpperCase().replace(/-/g, "_");
}

/**
 * Normalize a credential suffix to a canonical-style ID: lowercase and
 * replace underscores with hyphens. Returns the normalized ID; the caller
 * decides whether it is a known canonical ID.
 */
export function normalizeSuffix(suffix) {
  return String(suffix).toLowerCase().replace(/_/g, "-");
}

const CANONICAL_SET = new Set(CANONICAL_IDS);

export function isCanonicalId(id) {
  return CANONICAL_SET.has(id);
}

// A safe identifier for use as a filename / path component: canonical-style
// lowercase, digits and single hyphens, no leading/trailing/double hyphen,
// no separators or traversal. Used for role IDs and unknown-role credential
// filenames alike.
const SAFE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSafeId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 64 && SAFE_ID_RE.test(id);
}

// Map from suffix -> canonical ID, for credential parsing.
export const SUFFIX_TO_ID = Object.freeze(
  Object.fromEntries(CANONICAL_IDS.map((id) => [idToSuffix(id), id])),
);
