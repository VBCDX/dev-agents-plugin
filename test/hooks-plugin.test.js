// The dev-agents-hooks Claude Code plugin (plugins/dev-agents-hooks): its two hook scripts and
// the manifests that wire them. The credential-URL cases use generic hosts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { credentialUrlInGit, decide as guard, REASON } from "../plugins/dev-agents-hooks/scripts/credential-url-guard.mjs";
import { triggers, decide as remind, REMINDER } from "../plugins/dev-agents-hooks/scripts/review-panel-reminder.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(ROOT, "plugins", "dev-agents-hooks");
const SECRET = "hunter2-fixture";
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });

const DENIED = [
  'git clone https://bot:"$PASS"@git.example.com/o/r d',
  'git clone https://"$U:$P"@git.example.com/o/r d',
  'git clone https://"$U":"$P"@git.example.com/o/r d',
  "git clone https://bot:'secret'@git.example.com/o/r d",
  'git remote set-url origin https://bot:"$(cat /tmp/p)"@git.example.com/o/r',
  `git push https://bot:${SECRET}@git.example.com/o/r issue/1-x`,
  `git remote set-url origin https://bot:${SECRET}@git.example.com/o/r`,
  `cd /tmp/r && git remote add origin https://bot:${SECRET}@git.example.com/o/r`,
  'git clone "https://$U:$P@git.example.com/o/r" /tmp/d',
  "git clone https://${GIT_TOKEN}@git.example.com/o/r /tmp/d",
  'git clone "https://$(cat /tmp/creds)@git.example.com/o/r" /tmp/d',
  `git clone https://:${SECRET}@git.example.com/o/r /tmp/d`,
  `git config remote.origin.url https://u:${SECRET}@git.example.com/o/r`,
  `git -C /tmp/r config --replace-all remote.origin.pushurl 'https://u:${SECRET}@git.example.com/o/r'`,
  `bash -c 'git push https://u:${SECRET}@git.example.com/o/r issue/1-x'`,
  `/usr/bin/git fetch https://u:${SECRET}@git.example.com/o/r`,
  `git -c url.https://u:${SECRET}@git.example.com/.insteadOf=https://git.example.com/ fetch`,
  `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url GIT_CONFIG_VALUE_0=https://u:${SECRET}@h/r make`,
  `git-remote-https origin https://u:${SECRET}@git.example.com/o/r`,
  // a quote that straddles the @ is removed by the shell before git sees the URL
  `git remote set-url origin 'https://bot:${SECRET}'@git.example.com/o/r`,
  'git clone "https://bot:$PASS"@git.example.com/o/r /tmp/d',
  // written into a git config file by a non-git command
  `printf 'url = https://u:${SECRET}@git.example.com/o/r' >> .git/config`,
  'echo "\turl = https://u:$TOKEN@git.example.com/o/r" | tee -a /tmp/r/.git/config',
  `sed -i 's#https://git.example.com#https://u:${SECRET}@git.example.com#' .git/config`,
  `printf 'url = https://u:${SECRET}@h/r' >> .git/modules/sub/config`,
  // moved, copied or installed into a .git directory; a backslash-newline joined by the shell
  `printf 'url = https://u:${SECRET}@git.example.com/o/r' > /tmp/c && mv /tmp/c .git/`,
  `printf 'url = https://u:${SECRET}@h/r' > /tmp/c && cp /tmp/c .git/`,
  `printf 'url = https://u:${SECRET}@h/r' > /tmp/c && install -m 600 /tmp/c .git/`,
  `printf 'url = https://u:${SECRET}@h/r' >> .git/conf\\\nig`,
];

const ALLOWED = [
  'git commit -m "see https://example.com" && echo "a@b"',
  "git push origin issue/1-x",
  "git push -u origin issue/1-x",
  "git clone https://git.example.com/o/r /tmp/x",
  "git clone -c credential.helper='/opt/helper --agent EXAMPLE_AGENT' https://git.example.com/o/r /tmp/x",
  "git clone ssh://git@git.example.com:2222/o/r.git /tmp/x",
  "git clone git@github.com:o/r.git /tmp/x",
  'git clone "https://$GIT_HOST/o/r" /tmp/x',
  `mongosh "mongodb://u:${SECRET}@db:27017/app" --eval 1`,
  'curl -u "$U:$P" https://git.example.com/api/v1/version',
  "git log --grep 'user:pass@'",
  "cat .git/config && grep url .git/config",
  "printf 'url = https://git.example.com/o/r' >> .git/config",
  "echo 'url = ssh://git@git.example.com:2222/o/r.git' >> .git/config",
  `echo 'https://u:${SECRET}@h/r' > /tmp/note && grep -r url .git/refs`,
  // A single-quoted segment can't hold `/`: git sees `https://a:b/c@h/r`, where `a:b` is the
  // host and port and `/c@h/r` the path, so there is no credential.
  "git clone https://'a:b/c'@h/r /tmp/x",
];

test("credential-url-guard denies every git command that carries a URL credential", () => {
  for (const c of DENIED) {
    assert.equal(credentialUrlInGit(c), true, c);
    assert.deepEqual(guard(bash(c)), { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: REASON } }, c);
  }
});

test("credential-url-guard allows commands without a URL credential handed to git", () => {
  for (const c of ALLOWED) assert.deepEqual(guard(bash(c)), {}, c);
});

test("credential-url-guard never repeats the secret, and ignores events without a command", () => {
  assert.doesNotMatch(REASON, new RegExp(SECRET));
  assert.doesNotMatch(REASON, /@/);
  assert.deepEqual(guard({ tool_name: "Write", tool_input: { content: `https://u:${SECRET}@h` } }), {});
  assert.deepEqual(guard({}), {});
  assert.deepEqual(guard(null), {});
});

// Linear time, judged so a loaded runner cannot fail it. The answer must be right, and the best
// of three timings must stay under 1000 ms. Taking the best of three means a load spike has to
// hit every run to fail the test; correct code takes about 1-110 ms here unloaded (a single run
// reached about 400 ms on a loaded runner, past the old 250 ms bound). Every regression these
// cases record took seconds or never finished, so 1000 ms still catches them.
function assertFast(name, input, fn, want) {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    assert.equal(fn(input), want, name);
    best = Math.min(best, performance.now() - t0);
  }
  assert.ok(best < 1000, `${name}: best of three took ${best.toFixed(0)} ms`);
}

test("credential-url-guard scans adversarial and long input in linear time", () => {
  const linear = [
    // A long backtick run used to backtrack exponentially (n=40 was
    // killed by a 10s timeout before the branches were made disjoint).
    ["no-@ backtick run", `git clone https://${"`".repeat(4000)} /tmp/x`, false],
    ["backtick userinfo", `git clone https://${"`".repeat(4000)}@git.example.com/o/r /tmp/x`, true],
    // The scheme prefix used to be retried at every start position, so a
    // long alphanumeric run cost O(n^2) (~3.2s at 48KiB, ~13s at 100k). The scan
    // is anchored to `://` occurrences now.
    ["plain run", `git clone ${"a".repeat(100_000)} /tmp/x`, false],
    ["quoted run", `git clone "${"A".repeat(100_000)}" /tmp/x`, false],
    ["pipe run", `echo ${"x".repeat(100_000)} | base64 -d > /tmp/f`, false],
    ["scheme noise", `${"a://".repeat(20_000)}b`, false],
    ["mv run (no .git)", `mv ${"p ".repeat(50_000)}/tmp/x`, false],
    ["secret after a long run", `git clone ${"a".repeat(100_000)}https://u:p@h/r /tmp/x`, true],
    // The config-file check and the userinfo scan stay linear when `.git` and many
    // move words or `://` occurrences are present (these took seconds to tens of seconds).
    [".git-bearing mv run", `echo https://u:p@h/r ${"mv ".repeat(64_000)}x.git`, false],
    ["install run into .git", `echo https://u:p@h/r ${"install ".repeat(32_000)}x .git`, true],
    ["cp run into .git/", `echo https://u:p@h/r ${"cp ".repeat(64_000)}x .git/`, true],
    [".git/modules run", `echo https://u:p@h/r ${".git/modules/".repeat(20_000)}x`, false],
    [".git/modules run ending in config", `echo https://u:p@h/r ${".git/modules/".repeat(20_000)}x/config`, true],
    // Large enough that a per-occurrence forward search (even memchr-fast) shows up.
    ["$( URL run", "x://$(".repeat(100_000), false],
    ["${ URL run", "x://${".repeat(100_000), false],
    ["double-quote URL run", 'x://"'.repeat(40_000), false],
    ["$( URL run with a far close", `${"x://$(".repeat(40_000)})${"c".repeat(50_000)}`, false],
    ["quoted $( URL run with a far close", `${'x://"$('.repeat(40_000)})${"c".repeat(50_000)}`, false],
  ];
  for (const [name, c, want] of linear) assertFast(name, c, credentialUrlInGit, want);
});

const TRIGGERED = [
  "git push origin issue/1-x", "git push -u origin issue/1-x", "git -C /tmp/r push origin main",
  "git merge --no-ff feature", "cd /r && git push", "gh pr create --fill", "gh pr merge 12 --squash",
  "tea pr create --title x", "tea pulls create", "glab mr create", "glab mr merge 3",
  "git -c user.name=x push origin issue/2-y", "/usr/bin/git push", "bash -c 'git push origin x'",
  "sudo git push", "env GIT_TRACE=1 git push", "make test; git merge main", "a | gh pr create",
  "git --no-pager push", "git -p push origin main", "sh -c ' git push'", "eval \"git merge main\"",
  "set -e\ngit push origin main", "cd /r\ngh pr create --fill", "echo ok\n\ngit merge main",
];
const QUIET = [
  "git status", "git log --oneline", "git pull", "git commit -m 'push it later'", "echo git push",
  "gh pr view 12", "gh pr list", "git fetch origin", "npm run push-docs", "git stash push -m tag",
  "grep 'git push' notes.md", "echo gh pr create", "legit push",
  "gh repo create x", "glab issue create", "tea issues create", "gh pr checks 12",
];

test("review-panel-reminder fires after a push, a merge or a PR create/merge, and only then", () => {
  for (const c of TRIGGERED) {
    assert.equal(triggers(c), true, c);
    assert.deepEqual(remind(bash(c)), { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: REMINDER } }, c);
  }
  for (const c of QUIET) assert.deepEqual(remind(bash(c)), {}, c);
  assert.match(REMINDER, /review-agent, crazy-ivan and reward-hack-auditor-agent/);
  assert.match(REMINDER, /exact head SHA/);
});

test("review-panel-reminder decides adversarial and long commands in linear time", () => {
  // Each shape was exponential or quadratic in the regex trigger: a run of single-letter git
  // options (each readable alone or with the next token as its argument), `env` assignments
  // with several `=`, and chains of `sh -c '...'` scripts.
  const cases = [
    ["single-letter option run", `git ${"-x ".repeat(100_000)}`, false],
    ["single-letter option run then push", `git ${"-x ".repeat(100_000)}push`, true],
    ["mixed option run", `git ${"-x --foo ".repeat(50_000)}`, false],
    ["-C with an argument then merge", `git ${"-C dir ".repeat(50_000)}merge main`, true],
    ["env assignment run", `env ${"a=b=c=d ".repeat(50_000)}x`, false],
    ["many segments", "echo hi; ".repeat(50_000), false],
    ["sh -c quote run", "sh -c 'echo ".repeat(30_000), false],
    ["sh -c 'git chain", `sh ${"-c 'git ".repeat(60_000)}`, false],
    ["sh -c 'git chain then push", `sh ${"-c 'git ".repeat(60_000)}push`, true],
    ["sh -c 'env chain", `sh ${"-c 'env a=1 ".repeat(40_000)}x`, false],
  ];
  for (const [name, c, want] of cases) assertFast(name, c, triggers, want);
});

test("each hook script runs as a command: stdin event in, decision JSON out", () => {
  const run = (script, event) => {
    const r = spawnSync(process.execPath, [join(PLUGIN, "scripts", script)], { input: typeof event === "string" ? event : JSON.stringify(event), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.equal(run("credential-url-guard.mjs", bash(DENIED[5])).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(run("credential-url-guard.mjs", bash(ALLOWED[1])), {});
  assert.deepEqual(run("credential-url-guard.mjs", "not json"), {});
  assert.equal(run("review-panel-reminder.mjs", bash("gh pr create --fill")).hookSpecificOutput.additionalContext, REMINDER);
  assert.deepEqual(run("review-panel-reminder.mjs", bash("git status")), {});
});

test("the plugin and marketplace manifests wire the scripts that ship", () => {
  const plugin = readJson(join(PLUGIN, ".claude-plugin", "plugin.json"));
  assert.equal(plugin.name, "dev-agents-hooks");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  const hooks = readJson(join(PLUGIN, "hooks", "hooks.json")).hooks;
  const commands = Object.entries(hooks).flatMap(([event, entries]) => entries.map((e) => [event, e.matcher, e.hooks[0].command]));
  assert.deepEqual(commands.map(([e, m]) => [e, m]), [["PreToolUse", "Bash"], ["PostToolUse", "Bash"]]);
  for (const [, , command] of commands) {
    const m = command.match(/^node "\$\{CLAUDE_PLUGIN_ROOT\}"\/(scripts\/[\w-]+\.mjs)$/);
    assert.ok(m, command);
    assert.ok(existsSync(join(PLUGIN, m[1])), m[1]);
  }
  const market = readJson(join(ROOT, ".claude-plugin", "marketplace.json"));
  assert.equal(market.name, "vbcdx");
  assert.deepEqual(market.plugins.map((p) => [p.name, p.source]), [["dev-agents-hooks", "./plugins/dev-agents-hooks"]]);
  assert.ok(existsSync(join(ROOT, market.plugins[0].source, ".claude-plugin", "plugin.json")));
  const files = readJson(join(ROOT, "package.json")).files;
  assert.ok(files.includes("plugins") && files.includes(".claude-plugin"), "the npm package ships the plugin and the marketplace");
});
