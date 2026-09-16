#!/usr/bin/env node
// Executable entrypoint for @vbcdx/dev-agents.
//
// Usage:
//   vbcdx-dev-agents init --harness=<dsh|claude|codex|opencode> --env=<abs-path>
//                         [--agents=<list>] [--scope=<user|project>]
//                         [--profile=<name>] [--force] [--dry-run] [--quiet]
//   vbcdx-dev-agents --help
//   vbcdx-dev-agents --version
//
// Exit codes follow the spec taxonomy: 0 ok; 2 CLI/config; 3 credential;
// 4 filesystem; 5 conflict/scope/dependency; 6 native subprocess.

import { init, packageVersion } from "../src/index.js";
import { EXIT, InstallerError } from "../src/errors.js";

const HELP = `vbcdx-dev-agents — install the sixteen canonical VBCDX dev agents

Commands:
  init --harness=<dsh|claude|codex|opencode> --env=<absolute-config-path>
       [--agents=<comma,separated,ids>]   default: all sixteen
       [--scope=<user|project>]           default: user (not for dsh)
       [--profile=<name>]                 dsh only, default: web
       [--force]                          replace conflicting generated content
       [--dry-run]                        validate and plan only; write nothing
       [--quiet]                          suppress routine progress
  --help       show this help
  --version    print the package version

No credential or endpoint value is ever accepted on the command line. The
--env file is a literal configuration file (never sourced or interpolated).
`;

function printReport(report) {
  const lines = [];
  const verb = report.dryRun ? "Planned" : "Applied";
  lines.push(`${verb} install for harness=${report.harness} scope=${report.scope}${report.profile ? ` profile=${report.profile}` : ""}`);
  for (const g of report.generated) lines.push(`  definition ${g.role}: ${g.action} -> ${g.destination}`);
  if (report.dsh) {
    lines.push(`  dsh: ${report.dsh.action}; registration=${report.dsh.registration}; boot=${report.dsh.boot}`);
    if (report.dsh.registrationDetail) lines.push(`       ${report.dsh.registrationDetail}`);
    lines.push(`       staged plan: ${report.dsh.planPath}`);
  }
  for (const c of report.credentials) lines.push(`  credential ${c.role}: ${c.action}${c.unknown ? " (unknown role)" : ""}`);
  if (report.integrations && report.integrations.length) lines.push(`  integrations bound (offline): ${report.integrations.join(", ")} — runtime registration unverified`);
  if (report.launchEnv && Object.keys(report.launchEnv).length) {
    lines.push("  launch environment (set these before starting the harness):");
    for (const [k, v] of Object.entries(report.launchEnv)) lines.push(`    ${k}=${v}`);
  }
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write(packageVersion() + "\n");
    return 0;
  }
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return cmd === undefined ? 2 : 0;
  }
  if (cmd !== "init") {
    process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
    return EXIT.CONFIG;
  }

  const opts = argv.slice(1);
  const quiet = opts.includes("--quiet");
  try {
    const report = init(opts);
    if (!quiet) process.stdout.write(printReport(report) + "\n");
    // Warnings, conflicts, skips, and pending states are never suppressed.
    for (const w of report.warnings) process.stderr.write(`warning: ${w}\n`);
    if (report.dsh && report.dsh.boot === "pending") {
      process.stderr.write("note: DSH presets are staged pending the next operator-controlled boot; materialization and mount are a separate step.\n");
    }
    return EXIT.OK;
  } catch (err) {
    if (err instanceof InstallerError) {
      process.stderr.write(`error: ${err.message}\n`);
      return err.code;
    }
    process.stderr.write(`error: ${err && err.message ? err.message : String(err)}\n`);
    return EXIT.FILESYSTEM;
  }
}

main().then((code) => process.exit(code), (err) => {
  process.stderr.write(`fatal: ${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
