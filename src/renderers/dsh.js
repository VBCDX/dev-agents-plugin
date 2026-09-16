// DSH renderer (spec sections 7 and 8).
//
// Produces the two files a DSH preset needs: preset.yml (name, description,
// mount order) and agent.cordis.yml (a persona-first Cordis composition). The
// composition carries the canonical prompt as the persona row and enables the
// model-facing tool rows the role's capabilities call for. It contains no
// secrets and no model route (routing is injected at spawn). MCP service-client
// rows are owned by the companion service packages, not this installer, so they
// are not emitted here; a bound role's credential_file path is surfaced in the
// persona text via the shared binding note.
//
// These files are STAGED by init and materialized at DSH boot by the shared
// safe writer; init never boots a live DSH instance. Whether this composition
// mounts on a given DSH version is a release gate proven by issue #3, not by
// this renderer.

import { stringify as yamlStringify } from "yaml";
import { boundServiceTools, credentialBindingNote } from "./native.js";

// A stable, human-reviewed mount order so presets list predictably.
const ORDER = {
  "pm-agent": 10,
  "all-in-one-dev-agent": 15,
  "code-agent": 20,
  "review-agent": 30,
  "crazy-ivan": 40,
  "reward-hack-auditor-agent": 50,
  "security-agent": 60,
  "qa-agent": 70,
  "devops-agent": 80,
};

export function renderDshPreset(role) {
  const order = ORDER[role.id] ?? 100;
  return yamlStringify({
    name: role.descriptor.name,
    description: role.descriptor.description,
    order,
  });
}

export function renderDshComposition(role, { integrations } = {}) {
  const cap = role.descriptor.local_capabilities;
  const bindings = boundServiceTools(role.descriptor, integrations);
  const personaText = role.prompt.trimEnd() + "\n" + credentialBindingNote(bindings);

  const rows = [
    { id: "persona", name: "@deepseek-ai/dsh-persona", config: { text: personaText } },
    { id: "agent-instructions", name: "@deepseek-ai/dsh-agent-instructions", config: { maxBytes: 65536 } },
  ];
  if (cap.shell) rows.push({ id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash" });
  rows.push({ id: "tool-fs", name: "@deepseek-ai/dsh-tool-fs" });
  rows.push({ id: "tool-fs-search", name: "@deepseek-ai/dsh-tool-fs-search" });
  rows.push({ id: "tool-todo", name: "@deepseek-ai/dsh-tool-todo", config: { allowParallelInProgress: true } });
  rows.push({ id: "tool-ask-user", name: "@deepseek-ai/dsh-tool-ask-user" });
  rows.push({ id: "tool-web", name: "@deepseek-ai/dsh-tool-web", disabled: !cap.web });
  if (cap.delegation) {
    rows.push({
      id: "delegation",
      name: "cordis:group",
      group: true,
      isolate: { workflowEngine: true },
      config: [
        { id: "tool-subagent-control", name: "@deepseek-ai/dsh-tool-subagent-control" },
        { id: "tool-subagent", name: "@deepseek-ai/dsh-tool-subagent", config: { provider: "spawn", toolName: "subagent", backgroundMode: "continuable" } },
      ],
    });
  }
  return yamlStringify(rows);
}

/** The two DSH files for a role, as {name, content} entries. */
export function renderDsh(role, ctx = {}) {
  return {
    files: [
      { name: "preset.yml", content: renderDshPreset(role), mode: 0o644 },
      { name: "agent.cordis.yml", content: renderDshComposition(role, ctx), mode: 0o644 },
    ],
  };
}
