#!/usr/bin/env node
// PostToolUse hook (Bash): after a push, a merge or a pull-request create/merge, remind the
// agent that a pull request is done only when its review panel has passed at the exact head.
//
// The panel is the dev agents' own: review-agent (audit-trail review), crazy-ivan
// (adversarial failure-mode review) and reward-hack-auditor-agent, plus security-agent
// or qa-agent when the change calls for them. The reminder never blocks: it adds context.
//
// Input: the hook event JSON on stdin. Output: PostToolUse additional context, or `{}`.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A single pass over the command, with no backtracking regex: the command is split
// at shell separators (`;`, `&`, `|`, `(`, newline) and into whitespace tokens. A program
// is in command position at the start of a segment, or as the quoted script of
// `sh -c` / `bash -c` / `eval` (`bash -c 'git push'`), optionally behind `sudo`, or `env`
// and its `VAR=x` assignments, and named by a path or a bare name (`/usr/bin/git`). So
// `echo git push` and `grep 'git push' notes` are not pushes; `set -e\ngit push` is.
const SEPARATORS = /[;&|(\n]/;
const QUOTE = /^[`'"]/;
const ASSIGNMENT = /^[^=\s]+=/;
// git options before the subcommand: a single-letter option may take the next token as
// its argument (`-C <dir>`); a long or short option may carry `=value` (`--git-dir=x`).
const SHORT_OPTION = /^-[A-Za-z]$/;
const OPTION = /^--?[A-Za-z][\w-]*(?:=\S+)?$/;
const word = (re) => (token) => re.test(token);
const PUSH_OR_MERGE = word(/^(?:push|merge)(?![A-Za-z0-9_])/);
const CREATE_OR_MERGE = word(/^(?:create|merge)(?![A-Za-z0-9_])/);
const PR_NOUN = { gh: new Set(["pr"]), tea: new Set(["pr", "prs", "pull", "pulls"]), glab: new Set(["mr"]) };

/**
 * reaches[i]: the git options starting at tokens[i] can be read so that a push or merge
 * subcommand follows them. One backward pass per segment, so every `git` in the segment is
 * answered by a lookup: there is no per-occurrence rescan and no enumeration of readings.
 */
function gitReach(tokens) {
  const n = tokens.length;
  const reaches = new Uint8Array(n + 2);
  for (let i = n - 1; i >= 0; i--) {
    const t = tokens[i];
    reaches[i] = PUSH_OR_MERGE(t) ||
      (OPTION.test(t) && reaches[i + 1] === 1) ||
      (SHORT_OPTION.test(t) && i + 1 < n && reaches[i + 2] === 1) ? 1 : 0;
  }
  return reaches;
}

/**
 * True when the program at tokens[i] (after any sudo/env prefix) pushes, merges or opens a
 * PR. With stripQuote, tokens[i] opens a quoted script and its first character is dropped.
 */
function triggersAt(tokens, reaches, i, stripQuote) {
  let first = stripQuote ? tokens[i].slice(1) : tokens[i];
  if (first === "") { i++; first = tokens[i]; }
  if (first === "sudo") { i++; first = tokens[i]; }
  else if (first === "env") {
    i++;
    while (i < tokens.length && ASSIGNMENT.test(tokens[i])) i++;
    first = tokens[i];
  }
  if (first === undefined) return false;
  const program = first.slice(first.lastIndexOf("/") + 1);
  if (program === "git") return reaches[i + 1] === 1;
  if (PR_NOUN[program]) {
    return i + 2 < tokens.length && PR_NOUN[program].has(tokens[i + 1]) && CREATE_OR_MERGE(tokens[i + 2]);
  }
  return false;
}

export const REMINDER =
  "Every pull request needs independent verdicts at its exact head SHA: review-agent, crazy-ivan " +
  "and reward-hack-auditor-agent, plus security-agent or qa-agent when the change touches security " +
  "or a deployable service. A push after a verdict makes that verdict stale.";

/** True when the command pushes, merges, or creates or merges a pull request. */
export function triggers(command) {
  for (const segment of String(command).split(SEPARATORS)) {
    const tokens = segment.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const reaches = gitReach(tokens);
    if (triggersAt(tokens, reaches, 0, false)) return true;
    // The quoted script of `sh -c '...'` / `eval "..."` starts a command of its own.
    for (let j = 0; j + 1 < tokens.length; j++) {
      if ((tokens[j] === "-c" || tokens[j] === "eval") && QUOTE.test(tokens[j + 1]) &&
          triggersAt(tokens, reaches, j + 1, true)) return true;
    }
  }
  return false;
}

/** The hook's answer for one event. */
export function decide(event) {
  const input = event && typeof event.tool_input === "object" && event.tool_input ? event.tool_input : {};
  const command = typeof input.command === "string" ? input.command : "";
  if (!triggers(command)) return {};
  return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: REMINDER } };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let event = {};
  try { event = JSON.parse(raw); } catch { /* not an event: nothing to add */ }
  process.stdout.write(JSON.stringify(decide(event)) + "\n");
}

// Run when executed (the hook command), not when imported (the tests). Compare real paths:
// the plugin cache may reach this file through a symlink.
const isMain = () => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
if (process.argv[1] && isMain()) main();
