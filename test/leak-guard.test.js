// The repository is public (pack, tests, CI, scripts, vendored copies), so nothing in it may
// name one deployment: its hosts, nodes, operators, trackers or process. Every tracked file is
// scanned; the only file left out is this one. The patterns and samples are assembled from
// fragments, so this file never matches them itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const j = (...parts) => parts.join("");

// [label, pattern, a sample the pattern must match]
const DENY = [
  ["deployment hostname", new RegExp(j("tam", "tam"), "i"), j("git.", "tam", "tam", ".co")],
  ["node name", new RegExp(j("\\bai", "-001\\b"), "i"), j("ai", "-001")],
  ["node name", new RegExp(j("hermes", "AI"), "i"), j("hermes", "AI")],
  ["node name", new RegExp(j("hermes", "0[12]"), "i"), j("hermes", "02")],
  ["operator account", new RegExp(j("pv", "e-agent"), "i"), j("pv", "e-agent")],
  ["operator fork", new RegExp(j("\\bfork", " [A-D]\\b")), j("fork", " B")],
  ["operator fork", new RegExp(j("circle", "-q"), "i"), j("circle", "-q")],
  ["private tracker", new RegExp(j("infra", "structure/[\\w.-]+#\\d+")), j("infra", "structure/development#", "508")],
  ["private tracker", new RegExp(j("hermes", "-cluster"), "i"), j("hermes", "-cluster#18")],
  ["personal account", new RegExp(j("tya", "bonil"), "i"), j("tya", "bonil")],
  // A team's process belongs in its overlay, never in the pack: none of it may creep back.
  ["panel verdict grammar", new RegExp(j("IVAN", " VERDICT")), j("IVAN", " VERDICT: APPROVED")],
  ["panel state helper", new RegExp(j("ivan", "_state")), j("ivan", "_state_mark")],
  ["gate runner", new RegExp(j("audit", "\\.sh")), j("audit", ".sh gate")],
  ["gate status", new RegExp(j("reward-hack", "-audit(?![\\w-])")), j("reward-hack", "-audit status")],
  ["private helper call", new RegExp(j("\\bforgejo", "_[a-z_]+")), j("forgejo", "_comment_issue")],
  ["private media script", new RegExp(j("scripts/", "(?:video|image)-gen")), j("scripts/", "video-gen/assemble.sh")],
  ["milestone grammar", new RegExp(j("\\[agent", "-update\\]")), j("[agent", "-update] final")],
  ["house rule number", new RegExp(j("Rule", " #\\d")), j("Rule #", "11")],
  ["private ruling", new RegExp(j("#\\d+", " Q\\d")), j("#", "89 Q2")],
  ["persona source file", new RegExp(j("CONFIG", "\\.md")), j("CONFIG", ".md")],
  ["brand copy", new RegExp(j("Main", " Street|Burned", " Beth|Community", " Session"), "i"), j("Main", " Street")],
  ["provider key", new RegExp(j("GEMINI", "_API_KEY")), j("GEMINI", "_API_KEY")],
  ["email provider", new RegExp(j("Post", "mark")), j("Post", "mark")],
  // Hosts, trackers and addresses any private deployment might leak.
  ["private registry", new RegExp(j("verdacc", "io"), "i"), j("verdacc", "io")],
  ["node name", new RegExp(j("\\bapps", "-0\\d+\\b|\\bai-tool", "s\\b|\\bpv", "e\\d*\\b|\\bhermes", "-?\\d{2}\\b"), "i"), j("apps", "-002")],
  ["tracker shorthand", new RegExp(j("\\b(?:DEV|DAP|FP|CP|CSD|CW|CDB|vbcdx)", "#\\d+")), j("DAP#", "1")],
  ["infrastructure repository", new RegExp(j("\\binfra", "structure/[a-z][a-z-]+")), j("infra", "structure/example")],
  ["PaaS resource id", /\b(?=[a-z0-9]{24}\b)(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{24}\b/, j("a1b2c3d4e5f6", "g7h8i9j0k1l2")],
  ["private address", /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/, j("10.", "0.0.1")],
  ["agent credential key", new RegExp(j("\\bCODER", "_AGENT\\b|FORGEJO_(?:USER|PASS)", "_[A-Z]")), j("CODER", "_AGENT")],
  ["governance term", new RegExp(j("holacra", "cy"), "i"), j("Holacra", "cy")],
  ["bare issue number", /(?<![\w/&])#\d{1,4}\b/, j("see #", "40")],
  ["cross-repository tracker reference", /\b[A-Za-z][\w.-]*\/[\w.-]+#\d+/, j("acme/widget#", "26")],
  ["section mark", /§\s?\d/, j("spec §", "3")],
];

// Tokens written independently of DENY (and from fragments): every one must be caught by
// some DENY pattern, so deleting a row fails.
const REQUIRED = [
  j("tam", "tam"), j("ai", "-001"), j("hermes", "AI"), j("hermes", "01"), j("hermes", "02"),
  j("pv", "e-agent"), j("fork", " A"), j("fork", " D"), j("circle", "-q"),
  j("infra", "structure/caddy#", "64"), j("hermes", "-cluster"), j("tya", "bonil"),
  // A team process that belongs in an overlay.
  j("IVAN", " VERDICT"), j("ivan", "_state_mark"), j("audit", ".sh"), j("reward-hack", "-audit"),
  j("forgejo", "_upload_issue_asset"), j("scripts/", "image-gen"), j("[agent", "-update]"), j("Rule #", "11"),
  j("#", "89 Q2"), j("vbcdx#", "12"), j("FORGEJO_USER", "_CODE"), j("CONFIG", ".md"), j("Burned", " Beth"), j("Community", " Session"), j("GEMINI", "_API_KEY"), j("Post", "mark"),
];

const SELF = "test/leak-guard.test.js";

// Every file that goes to the public repository: what git tracks. Outside a git checkout
// (an unpacked tarball), fall back to walking the tree.
function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean).sort();
  } catch {
    const out = [];
    const walk = (d) => {
      for (const e of readdirSync(d).sort()) {
        if (["node_modules", ".git"].includes(e)) continue;
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(relative(ROOT, p));
      }
    };
    walk(ROOT);
    return out;
  }
}
const scanned = () => trackedFiles().filter((f) => f !== SELF);

function leaks(text) {
  return DENY.filter(([, re]) => re.test(text)).map(([label, re]) => `${label} ${re}`);
}

test("every deny pattern matches its sample, and this file's own text matches none", () => {
  for (const [label, re, sample] of DENY) assert.match(sample, re, `${label}: ${re} must catch ${sample}`);
  assert.deepEqual(leaks(readFileSync(fileURLToPath(import.meta.url), "utf8")), []);
});

test("the deny list covers every required token, so removing a pattern fails", () => {
  for (const token of REQUIRED) assert.ok(DENY.some(([, re]) => re.test(token)), `no deny pattern catches ${token}`);
});

test("the scan covers every tracked file except this one: no other blind spot", () => {
  const all = trackedFiles();
  assert.ok(all.includes(SELF));
  assert.deepEqual(all.filter((f) => !scanned().includes(f)), [SELF]);
  for (const f of ["README.md", "package.json", "vbcdx-pack.json", "assets/roles/pm-agent/prompt.md",
    ".forgejo/workflows/ci.yml", "test/roles.test.js", "test/vendor/vbcdx/SOURCE", "scripts/derive-roles.mjs"]) {
    assert.ok(all.includes(f), `${f} is scanned`);
  }
});

test("no tracked file names a deployment's hosts, nodes, operators, trackers or process", () => {
  const found = [];
  for (const file of scanned()) {
    const text = readFileSync(join(ROOT, file), "utf8");
    if (text.includes("\u0000")) continue; // binary
    text.split("\n").forEach((line, i) => {
      for (const hit of leaks(line)) found.push(`${file}:${i + 1}: ${hit}`);
    });
  }
  assert.deepEqual(found, []);
});
