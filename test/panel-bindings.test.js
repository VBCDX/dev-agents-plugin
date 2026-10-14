// A review panel needs one writer for its statuses and labels. In this pack that is the
// coordinator role, pm-agent (policy.kind "coordinator"), which holds `set_commit_status` on its
// own (no dispatch_workflow); the auditor roles stay verdict-only, with no status, label or
// assignee write. These tests pin the exact holder sets, so a later change cannot silently widen
// a panel role's writes or drop the coordinator's status write.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_IDS, getRole } from "./pack.js";

const ROUTING_HEADING = "## Where a finding goes (severity routing)";

const holders = (tool) =>
  CANONICAL_IDS.filter((id) =>
    (getRole(id).descriptor.remote_capabilities?.forgejo || []).includes(tool),
  ).sort();

/** One role's persona as a plain install renders it (the harness wrappers are vbcdx's to test). */
function renderedPrompts(id) {
  return { canonical: getRole(id).prompt };
}

/** The body of one `## Heading` section, up to the next same-level heading. */
function section(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `section ${JSON.stringify(heading)} is present`);
  const rest = text.slice(start + heading.length);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}

test("the exact set_commit_status holders, including the panel coordinator", () => {
  // The Q1 single-writer rule is scoped to a panel's verdict roles; the global
  // holder set below also carries the pre-existing CI_WRITE holders
  // (all-in-one-dev-agent, qa-agent). The panel-scoped verdict-only assertion
  // is "panel verdict roles stay verdict-only: no status, label or assignee
  // write" below.
  assert.deepEqual(holders("set_commit_status"), [
    "all-in-one-dev-agent",
    "pm-agent",
    "qa-agent",
  ]);
  const pm = getRole("pm-agent").descriptor.remote_capabilities.forgejo;
  assert.ok(pm.includes("set_commit_status"), "pm-agent writes the panel's statuses");
  assert.ok(
    !pm.includes("dispatch_workflow"),
    "the status grant carries no workflow dispatch (least privilege)",
  );
});

test("the coordinator holds the label write and the assignee edit", () => {
  assert.deepEqual(holders("set_issue_labels"), ["all-in-one-dev-agent", "pm-agent"]);
  assert.deepEqual(holders("update_issue"), ["all-in-one-dev-agent", "pm-agent"]);
});

test("panel verdict roles stay verdict-only: no status, label or assignee write", () => {
  // The panel's verdict roles report; the coordinator records. A write tool on
  // any of these re-splits the single-writer authority the ruling names.
  for (const id of ["review-agent", "security-agent", "crazy-ivan", "reward-hack-auditor-agent"]) {
    const tools = getRole(id).descriptor.remote_capabilities.forgejo || [];
    for (const tool of ["set_commit_status", "set_issue_labels", "update_issue"]) {
      assert.ok(!tools.includes(tool), `${id} must not hold ${tool}`);
    }
  }
});

