import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_TO_CANONICAL } from "../scripts/source-map.mjs";
import { CANONICAL_IDS, idToSuffix, normalizeSuffix, SUFFIX_TO_ID, allRoles, getRole } from "./pack.js";

test("there are exactly sixteen canonical roles", () => {
  assert.equal(CANONICAL_IDS.length, 16);
  assert.equal(new Set(CANONICAL_IDS).size, 16);
});

test("every source preset maps to a canonical ID and covers all sixteen", () => {
  const mapped = new Set(Object.values(SOURCE_TO_CANONICAL));
  assert.equal(mapped.size, 16);
  for (const id of CANONICAL_IDS) assert.ok(mapped.has(id), `missing mapping for ${id}`);
  assert.equal(SOURCE_TO_CANONICAL["all-tools"], "all-in-one-dev-agent");
  assert.equal(SOURCE_TO_CANONICAL["reward-hack-auditor"], "reward-hack-auditor-agent");
});

test("suffix round-trips with the canonical ID", () => {
  for (const id of CANONICAL_IDS) {
    const suffix = idToSuffix(id);
    assert.equal(normalizeSuffix(suffix), id, `suffix ${suffix} must normalize back to ${id}`);
    assert.equal(SUFFIX_TO_ID[suffix], id);
  }
  // The suffix is CODE_AGENT; the similar-looking account name is not a role.
  assert.equal(idToSuffix("code-agent"), "CODE_AGENT");
  assert.equal(SUFFIX_TO_ID[["CODER", "AGENT"].join("_")], undefined);
});

test("every role loads with a prompt and a valid descriptor", () => {
  const roles = allRoles();
  assert.equal(roles.size, 16);
  for (const id of CANONICAL_IDS) {
    const role = getRole(id);
    assert.ok(role, `role ${id} loads`);
    assert.ok(role.prompt.length > 0, `role ${id} has a prompt`);
    const d = role.descriptor;
    assert.equal(d.schema_version, 1);
    assert.equal(d.id, id);
    assert.equal(d.credential_suffix, idToSuffix(id));
    assert.ok(d.policy && typeof d.policy.kind === "string");
    assert.ok(["read-write", "read-only"].includes(d.local_capabilities.filesystem));
    assert.ok(typeof d.local_capabilities.shell === "boolean");
    assert.ok(["all", "primary"].includes(d.opencode_mode));
  }
});

test("prompts carry no forbidden infrastructure assumptions", () => {
  const forbidden = [/CODE_HOST_/, /\$D[S]H_HOME/, /curl\s+-/, /-sSk\b/, /\/api\/v1\/repos/, /NODE_TLS_REJECT/];
  for (const id of CANONICAL_IDS) {
    const { prompt } = getRole(id);
    for (const re of forbidden) {
      assert.doesNotMatch(prompt, re, `role ${id} prompt must not contain ${re}`);
    }
  }
});

// --- Web-capability bypass guard -------------------------------------------
// A persona must not teach the agent to route WEB RESEARCH through a shell
// fetch (`curl`/`wget`): that bypasses the role's declared web capability, and
// it is the same shape as a real bypass even when the fetch is a benign public
// read. A role that legitimately needs web research declares `web: true` and
// points at the web-search/web-fetch tools instead. (Regressed by
// copywriter-content/-marketing, video-creator and instructional-designer; hardened
// beyond the original "via bash curl" string.)
//
// The guard fires only on `web: true` roles: only a role that HAS the web tool
// can route AROUND it. A `web: false` role that `curl`s its OWN deployed
// service (qa-agent's smoke tests) has no web capability to bypass, so it is
// out of scope by construction, not by a phrasing carve-out.
//
// Detection targets the BEHAVIOUR (fetch web content with a shell client), not
// a fixed set of sample sentences. `curl`/`wget` is flagged in three shapes;
// every shape tolerates a wrapping backtick and man-page notation (`curl(1)`):
//   means-first  — curl/wget named as the fetch INSTRUMENT: "via bash curl",
//                  "use curl to retrieve", "with wget", and inflected /
//                  periphrastic means verbs: "by running curl", "by shelling
//                  out to curl", "by invoking curl".
//   object-first — curl/wget acting ON a web object: "curl the page",
//                  "wget the changelog", "curl the endpoint". An adjective or
//                  possessive may sit between the article and the object noun
//                  ("curl the vendor's site").
//   url-fetch    — curl/wget pointed straight at an http(s):// URL with no
//                  object noun at all: "curl -sL https://vendor.example/notes".
//                  This is the most natural way to write the bypass and the
//                  specific gap this guard once missed. Flags AND their
//                  values may sit between the tool and the URL — a method
//                  ("curl -X GET https://…") or a quoted, space-containing
//                  header ("curl -H 'Accept: application/json' https://…") — so
//                  an interposed argument no longer slips the URL past the
//                  matcher.
//
// A curl/wget co-mention is exempt ONLY when it is not a bypass, decided by
// MEANING, not word order:
//   * a fetch PIPED INTO a shell (`curl … | bash`) is the supply-chain
//     anti-pattern the security-agent names as something to flag, not content
//     for the agent to read; and
//   * a POSITIVE PEER ALTERNATION — curl and the web tool offered as
//     interchangeable options, joined by "or" or a slash, in EITHER order
//     ("re-fetch via web/curl", "curl/web", "use curl or the web tool", "the
//     web tool, or curl") — keeps the web tool a live option, so it is not
//     routing AROUND the capability.
// The polarity-inverted twin — the SAME two tokens joined by a comparative,
// negation, or conditional that DEMOTES the web tool ("curl instead of the web
// tool", "prefer curl over web", "if the web tool is down, curl the page") — is
// NOT exempt and is caught by a dedicated demotion detector (`webToolDemotion`).
// The exemption thus turns on curl's semantic role (peer vs. replacement), not
// on whether the web tool is merely named, which is why reordering — or
// inverting — the alternatives cannot flip the verdict.
//
// Shape detection reads the non-exempt lines rejoined into continuous prose, so
// a fetch whose means word and tool straddle a line break is still caught, while
// a legitimate curl on an exempt line cannot mask a bypass elsewhere. Demotion
// is tested per non-exempt line, since it is a same-sentence co-mention.
//
// OUT OF SCOPE, deliberately: non-curl/wget HTTP clients (HTTPie `http`,
// `fetch(1)`, `nc`, `python -m http.client`). Their command words (`http`,
// `fetch`, `nc`) are heavily overloaded in these prompts — "web fetch", the qa
// smoke `curl`/`fetch` pairing, "fetch the issue" — so matching them would
// trade this guard's precision for phantom coverage of clients no incident
// has involved. curl/wget are the specific, unambiguous shell-fetch
// verbs those incidents used. If a future prompt reaches for HTTPie/nc, extend
// the tool vocabulary here rather than loosening the means/object patterns.
// Every shape tolerates a wrapping backtick, man-page notation (`curl(1)`) and
// a verb inflection ("curling", "curl'ing", "curls").
const shellFetchMeansFirst =
  /\b(?:via|using|use|uses|with|through|run(?:s|ning)?|invok(?:e|ing)|call(?:ing)?|shell(?:ing)?\s+out\s+(?:to|with))\s+(?:bash\s+|the\s+shell\s+|your\s+shell'?s?\s+|a\s+shell\s+(?:to\s+)?)?`?(?:curl|wget)(?:\(\d\))?`?/i;
const shellFetchObjectFirst =
  /`?(?:curl|wget)(?:\(\d\))?(?:e?s|'?ing)?`?\s+(?:--?\S+\s+)*(?:the|an?|that|this|its|their|our|your)?\s*(?:[a-z][\w'’-]*\s+){0,2}?(?:web[- ]?)?(?:pages?|urls?|docs?|document|documentation|sites?|website|home[- ]?page|article|link|content|resource|endpoint|api|feed|json|html|xml|readme|change-?log|release\s+notes|notes|blog|wiki|spec|pricing|them|these|those)\b/i;
// url-fetch: curl/wget pointed at an http(s):// URL. Between the tool and the
// URL it tolerates a run of ARGUMENTS — each a flag (`-X`, `--header`), each
// optionally carrying one value: a quoted string that may contain spaces
// (`-H 'Accept: application/json'`) or a single bare token (the method in
// `-X GET`, `-u user:pass`, `-b cookie`). Without the value clause an interposed
// method or quoted header slips the URL past the matcher — the same class as the
// bare-`curl <URL>` gap the guard once missed. A bare arg is guarded by a
// negative lookahead so it cannot swallow the URL itself, and a run of pure
// prose ("curl is documented at https://…") never matches: with no leading flag
// the argument run is empty and the URL must sit immediately after the tool.
const shellFetchUrl =
  /`?(?:curl|wget)(?:\(\d\))?(?:e?s|'?ing)?`?\s+(?:--?\S+(?:\s+(?:'[^']*'|"[^"]*"|(?!https?:\/\/)\S+))?\s+)*(?:['"`])?https?:\/\//i;
// curl/wget piped straight into a shell is the `curl | bash` supply-chain
// anti-pattern, not a content fetch for the agent to read — exempt.
const pipedToShell = /`?(?:curl|wget)(?:\(\d\))?`?[^.\n]*\|\s*(?:bash|sh)\b/i;
// The web tool named alongside curl/wget as a POSITIVE PEER ALTERNATIVE — the
// two offered as interchangeable options ("use curl or the web tool", "the web
// tool, or curl", "web/curl", "curl/web"), in either order. This is the ONLY
// legitimate web-tool co-mention: the web tool stays a live option, so curl is
// not routing AROUND the capability. It is narrower than the prior "web tool
// named ANYWHERE on the line" carve-out, which dropped the whole line and let a
// polarity-inverted co-mention ("curl INSTEAD OF the web tool") ride out on the
// exemption.
const WEB_TOOL = String.raw`web[- ]?(?:search|fetch|tool|tools|research|browsing)`;
const webToolPeerAlternative = new RegExp(
  `(?:curl|wget)\\b[^.\\n]{0,20}\\bor\\b[^.\\n]{0,25}${WEB_TOOL}` +
    `|${WEB_TOOL}\\b[^.\\n]{0,20}\\bor\\b[^.\\n]{0,25}(?:curl|wget)` +
    `|web\\s*\\/\\s*(?:curl|wget)|(?:curl|wget)\\s*\\/\\s*web`,
  "i",
);
const lineIsExempt = (line) => pipedToShell.test(line) || webToolPeerAlternative.test(line);
// A co-mention that DEMOTES the web tool in favour of curl/wget: curl named as a
// replacement for, a preference over, or a fallback WHEN the web tool is
// unavailable — the "if the web tool is down, curl the page" failure class.
// This is the polarity-inverted twin of the peer alternation above: same two
// tokens, opposite meaning. The discriminator is the SEMANTIC ROLE (peer vs.
// replacement), operationalised by the closed class of English comparative /
// negation / conditional connectors that demote one alternative in favour of
// another — NOT a list of example sentences. It fires only when curl/wget
// AND the web tool co-occur on the SAME line, so it can never touch an ordinary
// curl line or an ordinary web-tool line; it complements the shape patterns,
// which already catch demotions that also spell out a fetch ("curl the page").
const demoteMarker = String.raw`instead(?:\s+of)?|rather\s+than|in\s+place\s+of|over\b|not\b|don'?t\s+use|do\s+not\s+use|avoid|skip|bypass|forgo`;
const webToolFallbackCond = String.raw`if|when|whenever|unless|should|once`;
const webToolDemotion = new RegExp(
  // curl favoured, web tool demoted after it: "prefer curl OVER the web tool".
  `(?:curl|wget)\\b[^.\\n]{0,30}\\b(?:${demoteMarker})[^.\\n]{0,30}${WEB_TOOL}` +
    // web tool negated / made conditional, curl the operative path after it:
    // "SKIP the web tool; curl the page", "IF the web tool is down, curl it".
    `|\\b(?:${demoteMarker}|${webToolFallbackCond})\\b[^.\\n]{0,50}${WEB_TOOL}\\b[^.\\n]{0,50}(?:curl|wget)`,
  "i",
);
const isShellFetch = (text) =>
  shellFetchMeansFirst.test(text) ||
  shellFetchObjectFirst.test(text) ||
  shellFetchUrl.test(text);
const teachesShellFetchForWeb = (prompt) => {
  const kept = prompt.split(/\r?\n/).filter((line) => !lineIsExempt(line));
  // Shape detection tolerates a cross-line split (means word and tool on
  // separate lines), so it runs on the kept lines rejoined into prose.
  if (isShellFetch(kept.join(" "))) return true;
  // Web-tool demotion is a same-sentence co-mention; test each kept line on its
  // own so a curl and a web-tool token that merely share a prompt (different
  // lines) can't phantom-match across the rejoin.
  return kept.some((line) => webToolDemotion.test(line));
};

test("no prompt teaches routing around its own web capability model", () => {
  // A web-enabled role must not contradict its own descriptor by claiming the
  // web tool is unavailable. "Web search unavailable: fall back ..." is a
  // legitimate failure-handling line and is intentionally not matched here.
  const claimsWebDisabled = /web[_ -]?search[^.\n]*\b(not part of this preset|intentionally disabled)/i;

  for (const id of CANONICAL_IDS) {
    const { prompt, descriptor } = getRole(id);
    if (descriptor.local_capabilities.web === true) {
      assert.ok(
        !teachesShellFetchForWeb(prompt),
        `role ${id} grants web:true but its prompt routes web research through a shell fetch (curl/wget)`,
      );
      assert.doesNotMatch(
        prompt,
        claimsWebDisabled,
        `role ${id} grants web:true but its prompt claims the web tool is disabled`,
      );
    }
  }
});

test("web-bypass guard catches shell-fetch regardless of phrasing", () => {
  // The guard must react to the BEHAVIOUR, not to the sample sentences in the
  // ticket. This corpus pins that: it fixes the phrasings crazy-ivan invented
  // in an adversarial review (11 of which slipped an earlier iteration) PLUS phrasings
  // of our own beyond that list, so a future narrowing of any pattern goes red
  // here rather than reopening the same gap a third time.
  const bypasses = [
    // bare `curl <URL>` with no means word and no object noun.
    // The blocking gap: the most natural way to write the bypass.
    "Grab the release notes: `curl -sL https://vendor.example/notes`.",
    "Just curl https://docs.vendor.example and read the output.",
    "curl https://example.com/pricing | jq . and read it.", // pipe is to jq, not a shell
    // inflected / periphrastic means verbs.
    "Read the spec by running curl against the vendor site.",
    "Retrieve the page by shelling out to curl.",
    // adjective / possessive between article and object noun.
    "curl the vendor's site and summarise the release notes.",
    // man-page notation.
    "You may `curl(1)` the page and read it.",
    // object nouns the old list omitted.
    "curl the endpoint and parse the response.",
    "wget the changelog before drafting.",
    "curl the readme for setup steps.",
    "curl the JSON feed and read it.",
    // cross-line split: means word and tool on different lines.
    "Fetch the notes via\ncurl and read them.",
    // Sanity cases (already caught before this pass — must stay caught).
    "via bash `curl`",
    "use curl to retrieve the docs",
    "curl the page",
    "wget the doc",
    "download the article using `curl`",
    "cURL the website",
    "use `wget`\nto download the reference doc",
    // Our own additions beyond the reviewer's list.
    "Pull the pricing by invoking curl on the vendor URL.",
    "wget the api feed and diff it.",
    "cURL the wiki page for the schema.",
    "Use wget to download the blog post.",
    "curl the site's documentation.",
    "Grab the reference by\nrunning `wget` on the docs site.",
    "curl -fsSL https://competitor.example/pricing and summarise it.",
    "Retrieve https://vendor.example via wget then read it.",
    "wget(1) the release notes for the changelog.",

    // ---- Gap 1: flags/headers between `curl` and the URL. ------------------
    // A non-flag argument (the method) or a quoted, space-containing header
    // value sits between `curl` and the URL, defeating the old flag-only
    // url-fetch clause; the URL's own words defeat object-first. Same class as
    // the bare-`curl <URL>` gap the guard once missed.
    "curl -X GET https://vendor.example/pricing",
    "curl -H 'Accept: application/json' https://vendor.example/api",
    "curl -A 'Mozilla/5.0' https://vendor.example/",
    // Our own flag/header variants beyond the first three.
    "curl --header 'X-Trace: 1' https://vendor.example/status", // long-form header flag
    "curl -b 'session=xyz; theme=dark' https://vendor.example/dash", // cookie value with a space
    "curl -u alice:secret --compressed -sSL https://vendor.example/private", // creds + several flags
    "curl -A 'Mozilla/5.0 (compatible; bot)' https://vendor.example/", // user-agent to dodge bot-blocking
    "curl -X POST -d '{\"q\":1}' https://vendor.example/graphql and read the reply", // method + data body
    "wget --header 'Accept: text/html' https://vendor.example/page", // wget, spaced header
    "curl https://vendor.example/notes -o out.html", // flag placed AFTER the URL
    // ---- Gap 1 lower-value misses (fixed while here). ---------------------
    "Just curling the changelog is enough.", // gerund inflection
    "curl them and summarise the differences.", // anaphoric object pronoun
    "curl the homepage for the hero copy.", // "homepage" object noun

    // ---- Gap 2: polarity-inverted web-tool co-mentions. -------------------
    // An exempt token no longer drops the whole line, so a co-mention that
    // INVERTS the meaning (curl as replacement / preference / fallback) is
    // caught rather than exempted. The fallback form is the original failure class.
    "fetch it via curl instead of the web tool",
    "prefer curl over the web tool", // no fetch shape; caught by demotion
    "skip the web tool; curl the page",
    "if the web tool is down, curl the page", // the original fallback class
    // From crazy-ivan review 2160's polarity list.
    "Fetch the changelog via curl instead of the web tool.",
    "Prefer curl over the web search tool for fetching docs.", // no fetch shape; demotion
    "Route research through curl, not the web-fetch tool.",
    "Skip the web tool; just curl the page.",
    "The web tool is slow, so curl the vendor site directly.",
    // Our own polarity variants beyond both lists.
    "Rather than the web tool, curl the pricing page.", // web tool negated first
    "Bypass the web-fetch tool and wget the changelog instead.", // bypass + fetch shape
    "When the web-search tool is unavailable, curl the docs.", // conditional fallback
  ];
  for (const s of bypasses) {
    assert.ok(teachesShellFetchForWeb(s), `bypass must be caught: ${JSON.stringify(s)}`);
  }

  // Exempt by meaning, not word order. These are the legitimate shapes a
  // web:true prompt may carry; the matcher must pass every one, in either order.
  const exempt = [
    // Piped into a shell — the `curl | bash` supply-chain anti-pattern.
    "Flag any unverified `curl | bash` in bootstrap scripts.",
    "no `chmod 777`, no unverified `curl | bash`, host firewall exposure",
    // Web tool named alongside curl, both orders (a fragility fix).
    "and re-fetch via web/curl for the deployed version unless the mirror covers it",
    "Re-fetch via curl/web for the deployed version.",
    "You may use curl or the web tool, whichever is handy.",
    "Prefer the web tool, or curl as a fallback.",
    // The two REAL exempted lines in the security-agent prompt, verbatim — the
    // ones crazy-ivan (review 2160) confirmed are the only legitimate ones. The exemption narrowing must keep BOTH green.
    "container-compose files, host bootstrap scripts (no `chmod 777`, no unverified `curl | bash`, host firewall exposure)",
    "consult your team's local vendor-docs mirror and re-fetch via web/curl for the deployed version unless the mirrored doc demonstrably covers it",
    // Peer alternation is exempt in EITHER order even when a preference word is
    // present, because the web tool stays a live, named option ("or"/slash) —
    // this is the boundary the demotion detector must NOT cross.
    "Prefer the web-search tool, or curl if you must.",
  ];
  for (const s of exempt) {
    assert.ok(!teachesShellFetchForWeb(s), `legitimate line must not be flagged: ${JSON.stringify(s)}`);
  }
});

test("no credential values are embedded and prompts are model routing free", () => {
  for (const id of CANONICAL_IDS) {
    const { prompt } = getRole(id);
    assert.doesNotMatch(prompt, /password\s*[:=]\s*\S/i);
  }
});

test("PM and all-in-one use OpenCode primary mode; others use all", () => {
  assert.equal(getRole("pm-agent").descriptor.opencode_mode, "primary");
  assert.equal(getRole("all-in-one-dev-agent").descriptor.opencode_mode, "primary");
  assert.equal(getRole("code-agent").descriptor.opencode_mode, "all");
});

test("inspection roles carry no merge authority and record advisory read-only", () => {
  for (const id of ["review-agent", "crazy-ivan", "reward-hack-auditor-agent", "security-agent"]) {
    const d = getRole(id).descriptor;
    assert.equal(d.policy.may_merge, false, `${id} must not merge`);
    assert.equal(d.policy.source_read_only, true, `${id} is source read-only`);
    assert.ok(!(d.remote_capabilities.forgejo || []).includes("merge_pull_request"));
  }
  // PM is the merge authority.
  assert.equal(getRole("pm-agent").descriptor.policy.may_merge, true);
  assert.ok(getRole("pm-agent").descriptor.remote_capabilities.forgejo.includes("merge_pull_request"));
  // Code agent never reviews.
  assert.ok(!getRole("code-agent").descriptor.remote_capabilities.forgejo.includes("create_review"));
});

test("only pm-agent and devops-agent may create repositories (forgejo create_repository)", () => {
  const allowed = CANONICAL_IDS.filter((id) => (getRole(id).descriptor.remote_capabilities?.forgejo || []).includes("create_repository"));
  assert.deepEqual(allowed.sort(), ["devops-agent", "pm-agent"]);
});

test("every audit role can emit its verdict as a review event", () => {
  // The audit briefs require ONE machine-parseable
  // verdict through the Forgejo review tool, pinned to the head SHA. A comment-only
  // binding cannot satisfy that — the mismatch security-agent once hit, where
  // the verdict arrived as an ordinary comment and a review-event consumer could not
  // see it at all.
  for (const id of ["review-agent", "crazy-ivan", "reward-hack-auditor-agent", "security-agent"]) {
    assert.ok(
      (getRole(id).descriptor.remote_capabilities.forgejo || []).includes("create_review"),
      `${id} must be able to post its verdict as a review event`,
    );
  }
});

test("the roles that file findings hold create_issue", () => {
  // A finding whose only home is a PR thread is lost when the PR closes (one
  // crazy-ivan once carried three findings inside an audit comment because
  // its bound toolset had no issue-creation tool). The recorded decision names
  // all three of these roles for create_issue, so the holder set below is
  // the recorded decision, not an omission.
  for (const id of ["crazy-ivan", "reward-hack-auditor-agent", "security-agent"]) {
    assert.ok(
      (getRole(id).descriptor.remote_capabilities.forgejo || []).includes("create_issue"),
      `${id} must be able to file a finding that outlives its PR`,
    );
  }
});

test("the findings widening stops at create_review and create_issue", () => {
  // Pin the exact holder sets. The reconciliation widens two descriptors by one
  // reviewed tool each; it must not creep into a general write grant, and a later
  // change must not silently add or drop one of the two tools for any role.
  const holders = (tool) =>
    CANONICAL_IDS.filter((id) =>
      (getRole(id).descriptor.remote_capabilities?.forgejo || []).includes(tool),
    ).sort();
  assert.deepEqual(holders("create_review"), [
    "all-in-one-dev-agent",
    "crazy-ivan",
    "review-agent",
    "reward-hack-auditor-agent",
    "security-agent",
  ]);
  assert.deepEqual(holders("create_issue"), [
    "all-in-one-dev-agent",
    "code-agent",
    "crazy-ivan",
    "pm-agent",
    "reward-hack-auditor-agent",
    "security-agent",
    "user-research-agent",
  ]);
});

test("get_review rides with list_reviews and is a read the panel roles hold", () => {
  // @vbcdx/forgejo-plugin ships `get_review` (GET /pulls/{n}/reviews/{id}, effect
  // read, scope read:repository) and flagged this repo's READS allow-list as the
  // rollout's concern. It is added to READS, so every role that can already list
  // reviews can read one — no role gains a review read without the other.
  const holders = (tool) =>
    CANONICAL_IDS.filter((id) =>
      (getRole(id).descriptor.remote_capabilities?.forgejo || []).includes(tool),
    ).sort();
  assert.deepEqual(holders("get_review"), holders("list_reviews"));
  assert.ok(holders("get_review").length > 0);
  // The panel roles that judge each other's reviews are among them.
  for (const id of ["review-agent", "security-agent", "crazy-ivan", "reward-hack-auditor-agent"]) {
    assert.ok(holders("get_review").includes(id), `${id} reads individual reviews`);
  }
  // Least privilege: no write/destructive tool may leak into any
  // role's allow-list. Pin the complete write surface — every canonical role
  // against the write/destructive catalogue — so an insertion under READS (or
  // any other group) turns this suite red. (Review 3507: the previous block
  // asserted membership in a Set this test had just built, and could never
  // fail.)
  const WRITE_TOOLS = new Set([
    "create_comment", "update_comment", "create_issue", "update_issue", "set_issue_labels",
    "create_pull_request", "update_pull_request", "create_review", "set_commit_status",
    "dispatch_workflow", "merge_pull_request", "create_repository",
  ]);
  const EXPECTED_WRITE_SURFACE = {
    "all-in-one-dev-agent": ["create_comment", "create_issue", "create_pull_request", "create_review", "dispatch_workflow", "set_commit_status", "set_issue_labels", "update_comment", "update_issue", "update_pull_request"],
    "code-agent": ["create_comment", "create_issue", "create_pull_request", "update_comment", "update_pull_request"],
    "copywriter-content": ["create_comment", "update_comment"],
    "copywriter-marketing": ["create_comment", "update_comment"],
    "crazy-ivan": ["create_comment", "create_issue", "create_review", "update_comment"],
    "designer-agent": ["create_comment", "update_comment"],
    "devops-agent": ["create_comment", "create_pull_request", "create_repository", "update_comment", "update_pull_request"],
    "instructional-designer-agent": ["create_comment", "update_comment"],
    "market-research-agent": ["create_comment", "update_comment"],
    "pm-agent": ["create_comment", "create_issue", "create_pull_request", "create_repository", "merge_pull_request", "set_commit_status", "set_issue_labels", "update_comment", "update_issue", "update_pull_request"],
    "qa-agent": ["create_comment", "create_pull_request", "dispatch_workflow", "set_commit_status", "update_comment", "update_pull_request"],
    "review-agent": ["create_comment", "create_review", "update_comment"],
    "reward-hack-auditor-agent": ["create_comment", "create_issue", "create_review", "update_comment"],
    "security-agent": ["create_comment", "create_issue", "create_review", "update_comment"],
    "user-research-agent": ["create_comment", "create_issue", "update_comment"],
    "video-creator": ["create_comment", "update_comment"],
  };
  const surface = {};
  for (const id of CANONICAL_IDS) {
    const held = (getRole(id).descriptor.remote_capabilities?.forgejo || [])
      .filter((tool) => WRITE_TOOLS.has(tool))
      .sort();
    if (held.length) surface[id] = held;
  }
  assert.deepEqual(surface, EXPECTED_WRITE_SURFACE);
});
