// Provenance / one-time derivation helper (NOT part of the runtime package,
// excluded from the published files list).
//
// The canonical prompt for each role was PORTED from the source dsh-agents
// personas at commit 6834a63424a512205b0295022468381a839251de by:
//
//   1. Dropping every line carrying an embedded infrastructure assumption the
//      spec forbids carrying forward: raw credentialed curl, HTTP Basic auth
//      recipes, `$DSH_HOME/.env` credential reads, `CODE_HOST_*` variable
//      mechanics, hand-built `/api/v1/repos/...` REST paths, and TLS-disabling
//      flags. None of those belong in a portable persona.
//   2. Appending one shared, role-neutral "Service access" section describing
//      the real model: remote capabilities exist only when the operator binds
//      a service integration, every service call carries an explicit
//      credential_file, no credential value ever lives in the prompt, and the
//      concrete tool allowlist for the role lives in its role.json descriptor.
//
// After this script produced the initial assets/roles/<id>/prompt.md files
// they became hand-maintained canonical source of truth (spec section 2: one
// canonical prompt per role, edited in place — never four hand-kept copies,
// never regenerated blindly). This script is retained only to document how the
// port was performed and to let a reviewer diff intent against the source.
//
// Usage (from a checkout that also has the source personas extracted):
//   node scripts/derive-prompts.mjs <source-personas-dir>

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_TO_CANONICAL } from "../src/roles/registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = process.argv[2];
if (!srcDir) {
  console.error("usage: node scripts/derive-prompts.mjs <source-personas-dir>");
  process.exit(2);
}

// A line is an infrastructure-mechanics line (dropped) when it carries any of
// these strong signals. Ordinary review targets such as "no credential leaks"
// or "credential leaks are a defect" survive because they lack these tokens.
const DROP_SIGNALS = [
  /CODE_HOST_/,
  /\$DSH_HOME/,
  /curl\s+-/,
  /-sSk\b/,
  /\/api\/v1\/repos/,
  /double-`?repos/,
  /bare[- ]host[- ]base/,
  /Authorization:\s*token/i,
  /HTTP Basic/i,
  /OPENROUTER_API_KEY/,
];

const SERVICE_SECTION = `
## Service access (Forgejo, Coolify, and other MCP servers)

Your remote capabilities are provided by MCP servers the operator registers
separately — this persona configures none of them. When no service integration
is bound you still work fully on local files and shell; remote reads and writes
simply are not available until an operator binds them.

- Every authenticated service tool call takes an explicit \`credential_file\`
  argument. You never assemble raw HTTP requests, never read credentials from
  the environment or a launch file, and never place a token, password, or
  username in a command line, a comment, a log, or a commit.
- No credential value appears anywhere in your work. Names and file paths only.
- The exact tools your role may call, and their read / write / destructive
  effect, are fixed by your role descriptor and the service manifest; you do
  not reach for a tool outside that allowlist to work around a missing binding.
- A missing or failed service binding is reported plainly and does not stop the
  independent local work you can still do.
`.trimStart();

// Remove headers whose section body became empty after line drops. Fence
// aware: `#` inside a fenced code block is content, not a header. Iterates to
// a fixed point so a parent header emptied by removing its only child is also
// removed.
function removeEmptyHeaders(text) {
  let lines = text.split("\n");
  for (let pass = 0; pass < 8; pass++) {
    const headerIdx = [];
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i])) inFence = !inFence;
      if (!inFence && /^#{1,6}\s+\S/.test(lines[i])) headerIdx.push(i);
    }
    const remove = new Set();
    for (let h = 0; h < headerIdx.length; h++) {
      const start = headerIdx[h];
      const end = h + 1 < headerIdx.length ? headerIdx[h + 1] : lines.length;
      let hasContent = false;
      for (let i = start + 1; i < end; i++) {
        if (lines[i].trim() !== "") hasContent = true;
      }
      if (!hasContent) remove.add(start);
    }
    if (remove.size === 0) break;
    lines = lines.filter((_, i) => !remove.has(i));
  }
  return lines.join("\n");
}

let count = 0;
for (const [srcName, canonicalId] of Object.entries(SOURCE_TO_CANONICAL)) {
  const srcFile = join(srcDir, `${srcName}.md`);
  if (!existsSync(srcFile)) {
    console.error(`missing source persona: ${srcFile}`);
    continue;
  }
  const raw = readFileSync(srcFile, "utf8");
  const kept = raw.split("\n").filter((line) => !DROP_SIGNALS.some((re) => re.test(line)));
  let body = removeEmptyHeaders(kept.join("\n")).replace(/\n{3,}/g, "\n\n").trim();
  const needsService = raw !== kept.join("\n");
  const out = needsService ? `${body}\n\n${SERVICE_SECTION}` : `${body}\n`;
  const outDir = join(here, "..", "assets", "roles", canonicalId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "prompt.md"), out.endsWith("\n") ? out : out + "\n");
  count++;
}
console.log(`derived ${count} canonical prompts`);
