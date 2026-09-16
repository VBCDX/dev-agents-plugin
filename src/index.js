// Public programmatic API for @vbcdx/dev-agents.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { parseInitArgs } from "./cli/args.js";
import { parseEnvFile } from "./config/env-parser.js";
import { buildPlan } from "./planner.js";
import { executePlan } from "./executor.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function packageVersion() {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
}

/**
 * Run `init` from an argv tail (the args after the `init` subcommand).
 * @param {string[]} argv
 * @param {object} [io] { cwd }
 * @returns {object} the execution report
 */
export function init(argv, io = {}) {
  const args = parseInitArgs(argv);
  const entries = parseEnvFile(args.env);
  const plan = buildPlan(args, entries, io);
  return executePlan(plan);
}

export { parseInitArgs } from "./cli/args.js";
export { buildPlan } from "./planner.js";
export { materializeFromPlan } from "./dsh/materializer.js";
export { EXIT, InstallerError } from "./errors.js";

// DSH host-half: DSH loads this package at boot and calls apply(). inject is
// empty (this package consumes no injected services).
export { inject, apply } from "./dsh/boot.js";
