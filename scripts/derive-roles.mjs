// Provenance / one-time derivation helper (NOT part of the runtime package).
//
// Emits assets/roles/<id>/role.json for every role vbcdx-pack.json lists, from an
// explicit, reviewable capability table. The table is the source of truth: CI
// regenerates the descriptors and fails on any drift, so change a capability
// here and re-run this script — never edit role.json by hand. The table below is
// the reviewed capability assignment referenced by spec sections 2 and 6.1:
// local file/shell permissions are separated from remote reporting/write
// permissions, inspection roles carry no source-write or merge authority, and
// no wildcard tool grant is used to paper over a missing binding.
//
// Usage: node scripts/derive-roles.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ROLE_IDS, SOURCE_TO_CANONICAL, idToSuffix } from "./source-map.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(readFileSync(join(here, "source-agent-cards.json"), "utf8"));
const CANONICAL_IDS = ROLE_IDS;
const CANONICAL_TO_SOURCE = Object.fromEntries(
  Object.entries(SOURCE_TO_CANONICAL).map(([s, c]) => [c, s]),
);

// ── Named service-tool groups (exact names from the v1 catalogs) ────────────
const FORGEJO = {
  READS: [
    "whoami", "list_repositories", "get_repository", "list_branches", "get_file",
    "list_issues", "get_issue", "list_comments", "get_comment", "list_labels",
    "list_milestones", "list_pull_requests", "get_pull_request",
    "list_pull_request_files", "get_pull_request_diff", "list_reviews", "get_review",
    "list_commit_statuses", "list_workflow_runs", "get_workflow_run", "list_workflow_jobs",
  ],
  COMMENT: ["create_comment", "update_comment"],
  ISSUE_FILE: ["create_issue"],
  ISSUE_MANAGE: ["update_issue", "set_issue_labels"],
  PR_WRITE: ["create_pull_request", "update_pull_request"],
  REVIEW: ["create_review"],
  CI_WRITE: ["set_commit_status", "dispatch_workflow"],
  // The panel coordinator is the single writer for its panel's statuses and
  // labels; the panel's
  // auditor roles stay verdict-only. Least privilege: the status write alone,
  // split out of CI_WRITE so the grant carries no workflow dispatch. The
  // audit status context itself is the team's own gate wiring
  // (operator-env only) — this capability is the coordinator's generic write.
  STATUS_WRITE: ["set_commit_status"],
  MERGE: ["merge_pull_request"],
  REPO_CREATE: ["create_repository"],
};
const COOLIFY = {
  READS: [
    "health", "version", "list_applications", "get_application", "get_application_logs",
    "list_application_envs", "list_databases", "get_database", "list_services",
    "get_service", "list_projects", "get_project", "list_servers", "get_server",
    "list_resources", "list_deployments", "get_deployment",
  ],
  LIFECYCLE: ["deploy", "start_application", "restart_application", "stop_application", "cancel_deployment"],
  ENV_WRITE: ["create_application_env", "update_application_env"],
  CREATE: ["create_application"],
};

function expand(catalog, groups) {
  const out = [];
  for (const g of groups) for (const t of catalog[g]) if (!out.includes(t)) out.push(t);
  return out;
}

// ── Reviewed per-role capability table ──────────────────────────────────────
// kind: implementer | coordinator | inspector | author | generalist
// fs:   "read-write" grants native file WRITE/EDIT tools; "read-only" does not.
// shell/web/delegation are native local capabilities.
// webSearch: the role gets web search through the operator's own LiteLLM gateway on
// harnesses that render it (Hermes: the web-litellm-search plugin), when the installer
// config names a gateway. The roles that must check a claim against a cited source, and
// market research, whose primary tool it is.
// sourceReadOnly / mayMerge are policy stances (advisory unless the harness or
// service credential actually enforces them — recorded honestly per role).
const T = {
  "all-in-one-dev-agent": {
    kind: "generalist", fs: "read-write", shell: true, web: true, delegation: true,
    sourceReadOnly: false, mayMerge: false, opencodeMode: "primary",
    forgejo: ["READS", "COMMENT", "ISSUE_FILE", "ISSUE_MANAGE", "PR_WRITE", "REVIEW", "CI_WRITE"],
    coolify: ["READS", "LIFECYCLE"],
  },
  "code-agent": {
    kind: "implementer", fs: "read-write", shell: true, web: false, delegation: false,
    sourceReadOnly: false, mayMerge: false, opencodeMode: "all",
    forgejo: ["READS", "COMMENT", "ISSUE_FILE", "PR_WRITE"], coolify: [],
  },
  "copywriter-content": {
    kind: "author", fs: "read-only", shell: true, web: true, delegation: false,
    sourceReadOnly: true, mayMerge: false, opencodeMode: "all",
    forgejo: ["READS", "COMMENT"], coolify: [],
  },
  "copywriter-marketing": {
    kind: "author", fs: "read-only", shell: true, web: true, delegation: false,
    sourceReadOnly: true, mayMerge: false, opencodeMode: "all",
    forgejo: ["READS", "COMMENT"], coolify: [],
  },
  "crazy-ivan": {
    kind: "inspector", fs: "read-only", shell: true, web: true, delegation: false,
    sourceReadOnly: true, mayMerge: false, opencodeMode: "all",
    webSearch: true,
    // ISSUE_FILE: a finding that must outlive its PR is filed as an issue — the
    // PR thread is lost when the PR closes.
    forgejo: ["READS", "REVIEW", "COMMENT", "ISSUE_FILE"], coolify: [],
  },
  "designer-agent": {
    kind: "author", fs: "read-only", shell: true, web: true, delegation: false,
    sourceReadOnly: true, mayMerge: false, opencodeMode: "all",
    forgejo: ["READS", "COMMENT"], coolify: [],
  },
  "devops-agent": {
    kind: "implementer", fs: "read-write", shell: true, web: true, delegation: false,
    sourceReadOnly: false, mayMerge: false, opencodeMode: "all",
    forgejo: ["READS", "COMMENT", "PR_WRITE", "REPO_CREATE"], coolify: ["READS", "LIFECYCLE", "ENV_WRITE", "CREATE"],
  },
  "instructional-designer-agent": {
    kind: "author", fs: "read-only", shell: true, web: true, delegation: false,
    sourceReadOnly: true, mayMerge: false, opencodeMode: "all",
    forgejo: ["READS", "COMMENT"], coolify: [],
  },
  "market-research-agent": {
    kind: "inspector", fs: "read-only", shell: true, web: true, delegation: false,
    // webSearch: web search is this role's primary research tool (its prompt says so).
    sourceReadOnly: true, mayMerge: false, opencodeMode: "all", webSearch: true,
    forgejo: ["READS", "COMMENT"], coolify: [],
  },
  "pm-agent": {
    kind: "coordinator", fs: "read-only", shell: true, web: false, delegation: true,
    sourceReadOnly: true, mayMerge: true, opencodeMode: "primary", webSearch: true,
    // The coordinator is the per-panel single writer for statuses and
    // labels — STATUS_WRITE adds the status write, ISSUE_MANAGE already carries
    // the label write + assignee edit. The panel's auditors keep none of these.
    forgejo: ["READS", "ISSUE_FILE", "ISSUE_MANAGE", "COMMENT", "PR_WRITE", "MERGE", "REPO_CREATE", "STATUS_WRITE"], coolify: ["READS"],
  },
  "qa-agent": {
    kind: "implementer", fs: "read-write", shell: true, web: false, delegation: false,
    sourceReadOnly: false, mayMerge: false, opencodeMode: "all",
    forgejo: ["READS", "COMMENT", "PR_WRITE", "CI_WRITE"], coolify: ["READS"],
  },
  "review-agent": {
    kind: "inspector", fs: "read-only", shell: true, web: true, delegation: false,
    sourceReadOnly: true, mayMerge: false, opencodeMode: "all", webSearch: true,
    forgejo: ["READS", "REVIEW", "COMMENT"], coolify: [],
  },
  "reward-hack-auditor-agent": {
    kind: "inspector", fs: "read-only", shell: true, web: true, delegation: false,
    sourceReadOnly: true, mayMerge: false, opencodeMode: "all",
    // ISSUE_FILE: a DIRTY finding that must outlive its PR is filed as an issue,
    // not left only in the verdict thread that is lost when the PR closes. The
    // audit roles (this one, crazy-ivan and security-agent) all file such issues,
    // so the grant is the recorded decision.
    forgejo: ["READS", "REVIEW", "COMMENT", "ISSUE_FILE"], coolify: [],
  },
  "security-agent": {
    kind: "inspector", fs: "read-only", shell: true, web: true, delegation: false,
    sourceReadOnly: true, mayMerge: false, opencodeMode: "all", webSearch: true,
    // REVIEW: the audit brief requires ONE machine-parseable verdict as a review
    // event on the PR, pinned to the head SHA; a comment-only binding could not
    // satisfy it.
    forgejo: ["READS", "ISSUE_FILE", "COMMENT", "REVIEW"], coolify: ["READS"],
  },
  "user-research-agent": {
    kind: "inspector", fs: "read-only", shell: true, web: true, delegation: false,
    sourceReadOnly: true, mayMerge: false, opencodeMode: "all",
    forgejo: ["READS", "ISSUE_FILE", "COMMENT"], coolify: [],
  },
  "video-creator": {
    // fs read-write: the role saves every generated clip, still and narration to a
    // workspace path before uploading it; it still never writes repository source.
    kind: "author", fs: "read-write", shell: true, web: true, delegation: false,
    sourceReadOnly: true, mayMerge: false, opencodeMode: "all",
    forgejo: ["READS", "COMMENT"], coolify: [],
  },
};

const POLICY_SUMMARY = {
  implementer: "Implements assigned work in its own worktree; opens pull requests but does not merge them.",
  coordinator: "Coordinates the pipeline and performs the team's authorized review and merge workflow; takes no implementation assignments.",
  inspector: "Inspects source and reports findings; does not modify source or merge. Its unrestricted shell means source read-only is an advisory policy, not a harness-enforced control.",
  author: "Produces its assigned deliverables and posts them; does not modify application source or merge.",
  generalist: "General development role spanning the full loop; opens pull requests but does not self-merge to shortcut review.",
};

let count = 0;
for (const id of CANONICAL_IDS) {
  const t = T[id];
  if (!t) throw new Error(`no capability entry for ${id}`);
  const srcName = CANONICAL_TO_SOURCE[id];
  const card = cards[srcName] || {};
  const forgejoTools = expand(FORGEJO, t.forgejo);
  const coolifyTools = expand(COOLIFY, t.coolify);
  const dependencies = {};
  if (forgejoTools.length) dependencies.forgejo = "vbcdx.forgejo/1";
  if (coolifyTools.length) dependencies.coolify = "vbcdx.coolify/1";

  const role = {
    schema_version: 1,
    id,
    credential_suffix: idToSuffix(id),
    name: card.name || id,
    description: card.description || "",
    policy: {
      kind: t.kind,
      summary: POLICY_SUMMARY[t.kind],
      source_read_only: t.sourceReadOnly,
      may_merge: t.mayMerge,
      enforcement:
        "Local file and shell access is granted by native harness tool permissions; " +
        "remote reads and writes are governed by the service write-mode and the token's " +
        "own scopes. Source-read-only and merge stances are advisory unless a native " +
        "control or credential scope actually enforces them.",
    },
    local_capabilities: {
      filesystem: t.fs,
      shell: t.shell,
      web: t.web,
      delegation: t.delegation,
    },
    web_search: Boolean(t.webSearch),
    remote_capabilities: {
      ...(forgejoTools.length ? { forgejo: forgejoTools } : {}),
      ...(coolifyTools.length ? { coolify: coolifyTools } : {}),
    },
    dependencies,
    opencode_mode: t.opencodeMode,
    ...(t.externalDependencies ? { external_dependencies: t.externalDependencies } : {}),
  };
  const outDir = join(here, "..", "assets", "roles", id);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "role.json"), JSON.stringify(role, null, 2) + "\n");
  count++;
}
console.log(`derived ${count} role descriptors`);
