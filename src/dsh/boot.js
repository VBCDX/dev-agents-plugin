// DSH boot host-half. When this package is registered into a DSH profile
// (via cordis.patch.yml), DSH loads it and calls apply() at composition boot.
// apply() reads the explicit staged-plan path from VBCDX_AGENTS_DSH_PLAN and
// materializes exactly that plan with the shared safe writer. It never boots or
// restarts DSH, never recursively removes anything, and is a no-op (with a
// diagnostic) when no plan path is configured — a missing path is a failed
// registration to surface, not a reason to crash the profile.

import { isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { materializeFromPlan } from "./materializer.js";

// DSH consumes no injected services from this package.
export const inject = [];

export function apply(log = console.log) {
  const planPath = process.env.VBCDX_AGENTS_DSH_PLAN;
  if (!planPath || !isAbsolute(planPath)) {
    log("vbcdx-dev-agents: VBCDX_AGENTS_DSH_PLAN is not set to an absolute staged plan path; nothing to materialize.");
    return { materialized: false, reason: "no-plan-path" };
  }
  if (!existsSync(planPath)) {
    log(`vbcdx-dev-agents: staged plan not found at ${planPath}; nothing to materialize.`);
    return { materialized: false, reason: "plan-missing" };
  }
  const report = materializeFromPlan(planPath);
  for (const f of report.files) log(`vbcdx-dev-agents: ${f.action} ${f.role} -> ${f.target}`);
  return { materialized: true, report };
}
