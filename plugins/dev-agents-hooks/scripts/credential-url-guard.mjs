#!/usr/bin/env node
// PreToolUse hook (Bash): deny a git command that carries credentials in a URL's userinfo.
//
// Git copies a remote URL into the argv of the git-remote-https helper it spawns, so
// `https://user:pass@host/...` is readable by anyone who can run `ps`, and a clone or
// `remote set-url` writes it into .git/config. Authenticate through a git credential
// helper instead. The hook never echoes the matched URL.
//
// Input: the hook event JSON on stdin. Output: a PreToolUse deny decision, or `{}`.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A URL's userinfo, scanned from just after each `://` up to the `@` that ends it. Its items:
// plain characters, or a whole command substitution / expansion, which may hold spaces and
// slashes (`$(cat /tmp/creds)`, `$TOKEN`, `${USER}`), a backtick pair (`https://u:`cmd`@h`),
// a single-quoted segment (no whitespace, `/` or `@`), or a double-quoted segment holding
// plain characters and the same expansions. Each item is told apart by its first character,
// so the parse never backtracks. A plain character is anything but whitespace,
// `/`, `@`, a quote, `$`, a backtick or `(`; inside double quotes, anything but those and `"`.
//
// The scan is linear in the text: a closing `)`, `}` or backtick is found
// through a precomputed next-occurrence table instead of a forward search, and the outcome
// from every item boundary is memoized, so overlapping `://` scans share the work instead
// of each rescanning the rest of the text.
const SCHEME_CHAR = /[A-Za-z0-9+.-]/;
const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;
const NOT_PLAIN = /[\s/@'"$`(]/;
const NOT_PLAIN_IN_DQ = /[\s/@"$`(]/;
const NOT_IN_SQ = /[\s/@']/;
const LETTER = /[A-Za-z]/;
// It carries a secret when it has a password (`user:pass`, `:token`) or a shell expansion
// that may resolve to one (`$TOKEN`, `${U}:${P}`, `$(cat f)`). A plain username
// (`ssh://git@host`) is not a secret and stays allowed. Recorded limitation: a PAT used AS
// the username (`https://ghp_xxx@host`) is therefore not denied by this hook.
const SECRET_MARKERS = /[:$`]/;
// git itself, a path to it, or one of the transport helpers it spawns.
const GIT_INVOCATION = /(?:^|[\s;&|()'"`/])git(?:-remote-[a-z]+)?(?=$|[\s;&|()'"`])/;
// Userinfo can also reach git through its environment-borne config...
const GIT_CONFIG_ENV = /\bGIT_CONFIG_(?:VALUE_[0-9]+|PARAMETERS)\s*=/;
// ...or be written into a git config file by any command (`printf ... >> .git/config`,
// `sed -i`, `tee -a`), after which a bare `git push` leaks it. A file moved, copied or
// installed into a `.git` directory lands at the same place. gitConfigFileWrite (below)
// checks both without a regex that rescans: one pass over whitespace tokens and one over
// `;`/`&`/`|` segments, each test a literal search or an end-anchored match.
const GIT_CONFIG_PATH = /\.git\/config(?![A-Za-z0-9_])|\.gitmodules(?![A-Za-z0-9_])/;
const MODULES_CONFIG = /\/config(?![A-Za-z0-9_])/;
const INTO_GIT_DIR = /^\s\.git(?:\/\S*)?$/;
const MOVE_WORD = /(?:^|[^A-Za-z0-9_])(?:mv|cp|install)(?![A-Za-z0-9_])/;

/**
 * True when the command names a git config file (`.git/config`, `.git/modules/<name>/config`,
 * `.gitmodules`) or moves, copies or installs into a `.git` directory as the last argument of
 * a `;`/`&`/`|`-separated command. Linear in the command length.
 */
export function gitConfigFileWrite(text) {
  if (!text.includes(".git")) return false;
  for (const token of text.split(/\s+/)) {
    if (!token.includes(".git")) continue;
    if (GIT_CONFIG_PATH.test(token)) return true;
    const m = token.indexOf(".git/modules/");
    // `.git/modules/<path>/config`: any later `/config` in the token (the path may nest).
    if (m !== -1 && MODULES_CONFIG.test(token.slice(m + ".git/modules".length))) return true;
  }
  for (const segment of text.split(/[;&|]/)) {
    // The segment's last argument is `.git` or a path under it, and an mv/cp/install
    // word comes before it.
    const s = segment.trimEnd();
    const ws = Math.max(s.lastIndexOf(" "), s.lastIndexOf("\t"), s.lastIndexOf("\n"), s.lastIndexOf("\r"));
    if (ws === -1 || !INTO_GIT_DIR.test(s.slice(ws))) continue;
    if (MOVE_WORD.test(s.slice(0, ws))) return true;
  }
  return false;
}
// The shell removes quotes before a program sees its arguments, so `'https://u:p'@host`
// reaches git as `https://u:p@host`: check the quote-free text too.
const QUOTES = /["']/g;
// ...and it joins a backslash-newline first, so `.git/conf\<newline>ig` is `.git/config`.
const LINE_CONTINUATION = /\\\n/g;

export const REASON =
  "Credentials in a git URL leak into `ps` output and .git/config. Use a plain https:// URL and " +
  "let a git credential helper supply the login (for example `git config credential.helper store`, " +
  "Git Credential Manager, or `git clone -c credential.helper=\"<helper>\" URL DIR`).";

/** Next-occurrence table: next[i] is the first index >= i holding ch, or -1. */
function nextTable(text, ch) {
  const next = new Int32Array(text.length + 1);
  let last = -1;
  next[text.length] = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === ch) last = i;
    next[i] = last;
  }
  return next;
}

/** A userinfo scanner over one text: end(p) is the `@` ending the userinfo from p, or -1. */
function userinfoScanner(text) {
  const n = text.length;
  const tables = {};
  const next = (ch, i) => (i > n ? -1 : (tables[ch] ??= nextTable(text, ch))[i]);
  // After `$` at i: the index just past `$(...)`, `${...}` or `$NAME`, or -1.
  const expansion = (i) => {
    const c = text[i + 1];
    if (c === "(" || c === "{") {
      const j = next(c === "(" ? ")" : "}", i + 2);
      return j === -1 ? -1 : j + 1;
    }
    if (c !== undefined && IDENT_START.test(c)) {
      let j = i + 2;
      while (j < n && IDENT_CHAR.test(text[j])) j++;
      return j;
    }
    return -1;
  };
  // Inside a double-quoted segment from q: the index just past its closing `"`, or -1.
  const dqMemo = new Map();
  const doubleQuoted = (q) => {
    const path = [];
    let r;
    for (;;) {
      if (dqMemo.has(q)) { r = dqMemo.get(q); break; }
      path.push(q);
      const c = text[q];
      if (c === undefined) { r = -1; break; }
      if (c === '"') { r = q + 1; break; }
      if (c === "$") { q = expansion(q); if (q === -1) { r = -1; break; } continue; }
      if (c === "`") { const j = next("`", q + 1); if (j === -1) { r = -1; break; } q = j + 1; continue; }
      if (NOT_PLAIN_IN_DQ.test(c)) { r = -1; break; }
      q++;
    }
    for (const x of path) dqMemo.set(x, r);
    return r;
  };
  const memo = new Map();
  return (p) => {
    const path = [];
    let r;
    for (;;) {
      if (memo.has(p)) { r = memo.get(p); break; }
      path.push(p);
      const c = text[p];
      if (c === undefined) { r = -1; break; }
      if (c === "@") { r = p; break; }
      if (c === "$") { p = expansion(p); if (p === -1) { r = -1; break; } continue; }
      if (c === "`") { const j = next("`", p + 1); if (j === -1) { r = -1; break; } p = j + 1; continue; }
      if (c === '"') { p = doubleQuoted(p + 1); if (p === -1) { r = -1; break; } continue; }
      if (c === "'") {
        let j = p + 1;
        while (j < n && !NOT_IN_SQ.test(text[j])) j++;
        if (text[j] !== "'") { r = -1; break; }
        p = j + 1;
        continue;
      }
      if (NOT_PLAIN.test(c)) { r = -1; break; }
      p++;
    }
    for (const x of path) memo.set(x, r);
    return r;
  };
}

/** True when any scheme-prefixed URL's userinfo in the text carries a secret. */
function hasSecretUrl(text) {
  if (!text.includes("://")) return false;
  const end = userinfoScanner(text);
  // markers[i]: how many of `:`, `$`, backtick occur in text[0..i).
  const markers = new Int32Array(text.length + 1);
  for (let i = 0; i < text.length; i++) markers[i + 1] = markers[i] + (SECRET_MARKERS.test(text[i]) ? 1 : 0);
  for (let at = text.indexOf("://"); at !== -1; at = text.indexOf("://", at + 3)) {
    // The scheme must run straight into this `://` and start with a letter; a
    // `[A-Za-z][A-Za-z0-9+.-]*` match begins at the first letter of that run.
    let start = at;
    while (start > 0 && SCHEME_CHAR.test(text[start - 1])) start--;
    while (start < at && !LETTER.test(text[start])) start++;
    if (start === at) continue;
    const e = end(at + 3);
    if (e !== -1 && markers[e] - markers[at + 3] > 0) return true;
  }
  return false;
}

/** True when the command would hand git a URL whose userinfo carries a secret. */
export function credentialUrlInGit(command) {
  const joined = String(command).replace(LINE_CONTINUATION, "");
  return (hasSecretUrl(joined) || hasSecretUrl(joined.replace(QUOTES, ""))) &&
    (GIT_INVOCATION.test(joined) || GIT_CONFIG_ENV.test(joined) || gitConfigFileWrite(joined));
}

/** The hook's answer for one event. */
export function decide(event) {
  const input = event && typeof event.tool_input === "object" && event.tool_input ? event.tool_input : {};
  const command = typeof input.command === "string" ? input.command : "";
  if (!credentialUrlInGit(command)) return {};
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: REASON } };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let event = {};
  try { event = JSON.parse(raw); } catch { /* not an event: allow, as an unparsable input carries no command */ }
  process.stdout.write(JSON.stringify(decide(event)) + "\n");
}

// Run when executed (the hook command), not when imported (the tests). Compare real paths:
// the plugin cache may reach this file through a symlink.
const isMain = () => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
if (process.argv[1] && isMain()) main();
