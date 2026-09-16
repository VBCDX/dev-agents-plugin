// A2A Agent Card builders (issue #5).
//
// Deterministically derives an A2A 1.0 Agent Card from a canonical role
// descriptor — the same single-source-of-truth rule the four renderers follow.
// There are no hand-authored card files; every card is a pure function of the
// committed role.json, so the sixteen cards can never drift.
//
// Schema verified against specification/a2a.proto in a2aproject/A2A (the spec's
// "single authoritative normative definition"). AgentCard REQUIRED fields:
// name, description, supportedInterfaces, version, capabilities,
// defaultInputModes, defaultOutputModes, skills. AgentInterface REQUIRED:
// url, protocolBinding, protocolVersion. AgentSkill REQUIRED: id, name,
// description, tags. JSON keys are camelCase (the protobuf canonical JSON
// mapping); the media type for a card is application/a2a+json.
//
// Design decision on this issue (see issue #5 discussion): these sixteen agents
// are role and prompt DEFINITIONS, not live A2A message endpoints — this server
// publishes their cards for discovery, it does not run the agents. A2A 1.0 has
// no descriptive-only card mode and REQUIRES a non-empty supportedInterfaces, so
// each card advertises exactly one interface whose url is the card's own
// resolvable HTTPS location with an HTTP+JSON binding, and capabilities is empty
// (no streaming/pushNotifications/etc. are implemented). A client that POSTs an
// A2A message to that url will not get a task back — that is the documented
// residual gap; a fully callable per-agent endpoint (spec `tenant` routing) is a
// separate, larger scope.

import { allRoles, getRole } from "../roles/index.js";
import { CANONICAL_IDS } from "../roles/registry.js";

// A2A protocol version negotiated on Major.Minor only ("Patch version numbers
// SHOULD NOT be used in Agent Cards").
export const A2A_PROTOCOL_VERSION = "1.0";

// Media type for an A2A JSON document.
export const A2A_MEDIA_TYPE = "application/a2a+json";

// The organization that authors these cards. Matches package.json "author".
const PROVIDER_ORGANIZATION = "VBCDX";

// Modes the agents work in. They consume and produce natural-language text.
const DEFAULT_INPUT_MODES = Object.freeze(["text/plain"]);
const DEFAULT_OUTPUT_MODES = Object.freeze(["text/plain"]);

// Remote-capability service keys are mapped to GENERIC, vendor-neutral skill
// tags — never the vendor name itself — to keep cards free of internal infra
// detail. An unknown service key is intentionally dropped rather than leaked, so
// adding a new backend later cannot silently publish its name in a public card.
const SERVICE_TAG = Object.freeze({
  forgejo: "code-host",
  coolify: "deployment",
});

// Strip a single trailing slash so URLs join cleanly.
function trimTrailingSlash(url) {
  return String(url).replace(/\/+$/, "");
}

// The card version is the agent definition's version, derived from the role
// descriptor's schema_version as Major.0.0 (e.g. schema_version 1 -> "1.0.0").
function cardVersion(descriptor) {
  const major = Number.isInteger(descriptor.schema_version) ? descriptor.schema_version : 1;
  return `${major}.0.0`;
}

// Vendor-neutral capability tags for a role's single skill.
function skillTags(descriptor) {
  const tags = [];
  if (descriptor.policy && descriptor.policy.kind) tags.push(descriptor.policy.kind);
  const local = descriptor.local_capabilities || {};
  if (local.filesystem) tags.push(`filesystem:${local.filesystem}`);
  if (local.shell) tags.push("shell");
  if (local.web) tags.push("web");
  if (local.delegation) tags.push("delegation");
  const remote = descriptor.remote_capabilities || {};
  for (const service of Object.keys(remote)) {
    const tag = SERVICE_TAG[service];
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

// One AgentSkill per agent, representing its role. description falls back to the
// full descriptor description if the policy has no summary.
function roleSkill(descriptor) {
  return {
    id: descriptor.id,
    name: descriptor.name,
    description: (descriptor.policy && descriptor.policy.summary) || descriptor.description,
    tags: skillTags(descriptor),
  };
}

/**
 * Build the A2A Agent Card for one role. Pure and deterministic: identical
 * (role, baseUrl) inputs always produce a byte-identical serialization.
 * Key insertion order is fixed here so JSON.stringify output is stable.
 */
export function buildAgentCard(role, baseUrl) {
  const descriptor = role.descriptor;
  const base = trimTrailingSlash(baseUrl);
  const cardUrl = `${base}/agents/${descriptor.id}.json`;
  return {
    name: descriptor.name,
    description: descriptor.description,
    version: cardVersion(descriptor),
    provider: { organization: PROVIDER_ORGANIZATION, url: base },
    documentationUrl: `${base}/agents/`,
    supportedInterfaces: [
      {
        url: cardUrl,
        protocolBinding: "HTTP+JSON",
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    capabilities: {},
    defaultInputModes: [...DEFAULT_INPUT_MODES],
    defaultOutputModes: [...DEFAULT_OUTPUT_MODES],
    skills: [roleSkill(descriptor)],
  };
}

/** The card for a known canonical agent id, or undefined for an unknown id. */
export function getAgentCard(id, baseUrl) {
  const role = getRole(id);
  if (!role) return undefined;
  return buildAgentCard(role, baseUrl);
}

/** All sixteen cards keyed by canonical id, in canonical order. */
export function allAgentCards(baseUrl) {
  const out = new Map();
  for (const [id, role] of allRoles()) out.set(id, buildAgentCard(role, baseUrl));
  return out;
}

/**
 * The index served at /agents/ — a plain JSON listing of the available cards so
 * a consumer can enumerate the sixteen without guessing ids.
 */
export function buildIndex(baseUrl) {
  const base = trimTrailingSlash(baseUrl);
  return {
    agents: CANONICAL_IDS.map((id) => ({
      id,
      name: getRole(id).descriptor.name,
      url: `${base}/agents/${id}.json`,
    })),
  };
}

/**
 * The card served at /.well-known/agent-card.json — describes THIS server (a
 * directory/aggregator), keeping the deployment discoverable via the A2A
 * convention while the per-agent cards live under /agents/.
 */
export function buildServerCard(baseUrl) {
  const base = trimTrailingSlash(baseUrl);
  return {
    name: "VBCDX Dev Agents Directory",
    description:
      "Publishes A2A agent cards for the canonical VBCDX development agents at " +
      "/agents/<id>.json. Discovery only: the cards describe agent role and " +
      "prompt definitions, not live task endpoints.",
    version: "1.0.0",
    provider: { organization: PROVIDER_ORGANIZATION, url: base },
    documentationUrl: `${base}/agents/`,
    supportedInterfaces: [
      {
        url: `${base}/agents/`,
        protocolBinding: "HTTP+JSON",
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    capabilities: {},
    defaultInputModes: [...DEFAULT_INPUT_MODES],
    defaultOutputModes: [A2A_MEDIA_TYPE],
    skills: [
      {
        id: "list-agent-cards",
        name: "List agent cards",
        description:
          "Enumerate and serve the A2A agent cards for the canonical development agents.",
        tags: ["directory", "discovery"],
      },
    ],
  };
}
