// Translation from the abstract capability model in each role.json to real
// native harness controls and registered tool identifiers (spec sections 2,
// 6.1, 7). This is the single place capabilities become native controls, so a
// role's local file/shell/web/delegation flags and its reviewed remote tool
// allowlist map deterministically and identically for every harness — there is
// no per-harness hand-maintained tool list to drift.

// ── Claude ──────────────────────────────────────────────────────────────────
// Built-in Claude tool names (verified against code.claude.com/docs sub-agents).
export function claudeLocalTools(cap) {
  const tools = ["Read", "Grep", "Glob", "TodoWrite"];
  if (cap.filesystem === "read-write") tools.push("Write", "Edit");
  if (cap.shell) tools.push("Bash");
  if (cap.web) tools.push("WebFetch", "WebSearch");
  if (cap.delegation) tools.push("Agent");
  return tools;
}

// ── OpenCode ──────────────────────────────────────────────────────────────
// permission map: allow|ask|deny per built-in capability key (verified against
// opencode.ai/docs). Reads/search/todo are always allowed; edit/bash/web/task
// follow the capability flags.
export function opencodePermission(cap) {
  const allowDeny = (on) => (on ? "allow" : "deny");
  return {
    read: "allow",
    grep: "allow",
    glob: "allow",
    list: "allow",
    todowrite: "allow",
    edit: allowDeny(cap.filesystem === "read-write"),
    bash: allowDeny(cap.shell),
    webfetch: allowDeny(cap.web),
    websearch: allowDeny(cap.web),
    task: allowDeny(cap.delegation),
  };
}

// ── Codex ─────────────────────────────────────────────────────────────────
// Codex has no per-agent tool allowlist field; its enforceable native control
// is sandbox_mode. Delegation uses Codex's native agent type and needs no
// invented field.
export function codexSandboxMode(cap) {
  return cap.filesystem === "read-write" ? "workspace-write" : "read-only";
}

// ── Remote service bindings ─────────────────────────────────────────────────
// Native MCP tool identifier per harness. Claude and DSH use the
// mcp__<server>__<tool> form; OpenCode uses <server>_<tool>.
export function mcpToolId(harness, server, tool) {
  if (harness === "opencode") return `${server}_${tool}`;
  return `mcp__${server}__${tool}`;
}

/**
 * Compute the bound service tools for a role given the validated integrations.
 * A tool is bound only if it is in BOTH the role's reviewed remote allowlist
 * AND the service manifest, AND the role has an explicit credential mapping for
 * that service. Never widens to a wildcard to recover a missing tool.
 *
 * @returns {Array<{server:string, credentialFile:string, tools:string[]}>}
 */
export function boundServiceTools(descriptor, integrations) {
  const out = [];
  if (!integrations || !integrations.services) return out;
  const remote = descriptor.remote_capabilities || {};
  for (const [server, svc] of Object.entries(integrations.services)) {
    const allowlist = remote[server];
    if (!allowlist || allowlist.length === 0) continue;
    const credentialFile = svc.credentials ? svc.credentials[descriptor.id] : undefined;
    if (!credentialFile) continue; // no explicit mapping -> no binding for this role
    const manifestSet = new Set(svc.tools);
    const tools = allowlist.filter((t) => manifestSet.has(t));
    if (tools.length === 0) continue;
    out.push({ server, credentialFile, tools: [...tools].sort() });
  }
  return out;
}

/**
 * A plain-text note, appended to a rendered definition, telling the model which
 * absolute credential_file to pass for each bound service and which tools its
 * role may call. Contains the path only, never a credential value, and never
 * instructions to parse the file.
 */
export function credentialBindingNote(bindings) {
  if (!bindings.length) return "";
  const lines = ["", "## Bound service credentials", ""];
  for (const b of bindings) {
    lines.push(
      `- \`${b.server}\`: pass \`credential_file="${b.credentialFile}"\` on every ${b.server} tool call. ` +
        `Tools available to your role: ${b.tools.join(", ")}.`,
    );
  }
  return lines.join("\n") + "\n";
}
