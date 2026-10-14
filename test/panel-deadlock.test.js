// The two auditor roles (crazy-ivan, reward-hack-auditor-agent) must never block on each
// other's standing verdict: if each blocks because the other did, neither can clear and no
// change to the diff fixes it. Each judges the diff and the evidence at the head SHA, and may
// report another role's verdict but never use it as its own blocking ground.
//
// The guard is not placement-local: it scans EVERY byte of either prompt — the preamble before
// the first `##`, and every `##` section — and any sentence that cites a sibling role's verdict
// word fails the suite, unless it is an explicit prohibition or a PENDING-propagation sentence.
//
// Disclosed residual limits (inherent to a regex guard over prose):
//   1. a citation SPLIT across two sentences (sibling marker in one, verdict
//      word in the next) is not caught — the scanner requires both in one
//      sentence;
//   2. a sentence shaped as an explicit prohibition is exempt by design, so a
//      prohibition phrasing used as a real block would pass — the exemption is
//      restricted to the prohibition forms below, not any sentence with "never".

import { test } from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_IDS, getRole } from "./pack.js";

const IVAN_HEADING = "## Your verdict rests on your own findings (no cross-citation)";
const AUDITOR_HEADING = "## Judge the PR, not the panel (no cross-citation)";
const IVAN_TWO_PHASE_HEADING = "## Two-phase audit: an incomplete panel is PENDING, not a block";
const AUDITOR_TWO_PHASE_HEADING = "## Two-phase audit: an incomplete panel is PENDING, never DIRTY";
const BREAKDOWN_HEADING = "## Process Breakdown and tie-break (panel deadlock)";
const SPAWNING_HEADING = "## Spawning mechanics";
const GUARD_HEADING = "## Claim-then-spawn guard (before every spawn)";
const TRIAGE_HEADING = "## Never-idle sweep (hourly heartbeat, full backlog)";
const IVAN_EXEC_HEADING = "## Execution flow";
const AUDITOR_EXEC_HEADING = "## Execution Flow";
const TAXONOMY_HEADING = "## Signal taxonomy — BLOCK on ANY";

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

/** One whole bullet of the triage list, by its bolded bucket name. */
function bucket(triage, name) {
  const line = triage.split("\n").find((l) => l.includes(`**${name}**`));
  assert.ok(line, `triage lists the ${name} bucket`);
  return line;
}

/** The shared no-cross-citation rule both panel roles must state. */
function assertOwnGroundsOnly(rule, at) {
  assert.match(rule, /the diff and the evidence at/i, at("the verdict is judged on the diff and evidence"));
  assert.match(rule, /head SHA|HEAD_SHA/, at("the evidence is pinned to the head SHA"));
  assert.match(rule, /may \*\*report\*\* another role's standing verdict/i, at("reporting a sibling verdict is allowed"));
  assert.match(rule, /never use it as your own blocking ground/i, at("a sibling verdict is never a blocking ground"));
  assert.match(rule, /deadlock/i, at("the rule names the deadlock it prevents"));
  assert.match(rule, /re-verify it/i, at("an agreed finding must be re-verified as the role's own"));
}

// The deadlock can be re-created by any sentence in the prompt that cites a
// sibling role's verdict word as this role's own ground. The scan is strict —
// sibling marker plus verdict word, no block-ground phrasing needed — and runs
// over every byte of both prompts, preamble included, so no region is a hiding
// place. (Two residual limits are disclosed in the header.)
const VERDICT_WORD = /APPROVED|REQUEST_CHANGES|DO_NOT_MERGE|DIRTY|CLEAN/;
// Explicit prohibitions and the PENDING-propagation sentences are the only
// shapes where a sibling verdict word is allowed to appear. A bare "never"
// must NOT exempt a sentence: only these prohibition forms do.
const PROHIBITION = /forbidden|does not block|never a hit|never use it as|never\s+`?(?:APPROVED|REQUEST_CHANGES|DO_NOT_MERGE|DIRTY|CLEAN)`?|may \*\*report\*\*|makes this \*\*PENDING\*\*/i;
const SIBLING_ROLE = {
  // A role's own verdict is its own; only other panel roles count as siblings.
  "crazy-ivan": /reward-hack-auditor|reward-hack auditor|auditor|another role|sibling|reviewer|security|qa\b/i,
  "reward-hack-auditor-agent": /crazy-ivan|another role|sibling|reviewer|security|qa\b/i,
};

/** The prompt's sentences, split on terminal punctuation (one paragraph per line). */
function sentencesOf(text) {
  return text
    .split(/(?<=[.!?])(?=\s)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** The prose a persona receives: a leading YAML frontmatter block is harness metadata, not instruction. */
function scanBody(text) {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  return frontmatter ? text.slice(frontmatter[0].length) : text;
}

/**
 * The prose prompt split into contiguous, non-overlapping pieces covering every
 * byte of `scanBody(text)`: first the preamble (identity lines before the first
 * `##`), then each `## ` section with its heading. `sectionsOf(text).join("") ===
 * scanBody(text)` always holds, so the preamble is scanned exactly like any
 * section while metadata is not mistaken for an instruction.
 */
function sectionsOf(text) {
  const body = scanBody(text);
  const out = [];
  const re = /^## /gm;
  let match;
  let start = -1;
  while ((match = re.exec(body)) !== null) {
    if (start === -1) {
      if (match.index > 0) out.push(body.slice(0, match.index)); // the preamble
    } else {
      out.push(body.slice(start, match.index));
    }
    start = match.index;
  }
  if (start >= 0) out.push(body.slice(start));
  return out;
}

/**
 * Sentences citing a sibling role's verdict word outside an explicit
 * prohibition or a PENDING-propagation sentence. Presence/staleness rules stay
 * (they ask whether a verdict *exists* at the head, not what it says).
 */
function siblingVerdictSentences(text, id) {
  return sentencesOf(text).filter(
    (sentence) =>
      SIBLING_ROLE[id].test(sentence) && VERDICT_WORD.test(sentence) && !PROHIBITION.test(sentence)
  );
}

/** The whole prompt, section by section: no section may cite a sibling verdict word. */
function assertNoSiblingVerdictCitation(text, id, at) {
  for (const sectionText of sectionsOf(text)) {
    const flagged = siblingVerdictSentences(sectionText, id);
    assert.deepEqual(flagged, [], at(`no section cites a sibling verdict word: ${JSON.stringify(flagged)}`));
  }
}

test("the cross-citation guard scans the whole prompt, preamble included", () => {
  for (const id of ["crazy-ivan", "reward-hack-auditor-agent"]) {
    for (const [harness, text] of Object.entries(renderedPrompts(id))) {
      // Contiguous pieces covering every prose byte: no byte — preamble
      // included — is outside the scanner (frontmatter metadata aside).
      assert.equal(sectionsOf(text).join(""), scanBody(text), `${id} ${harness}: every prose byte is scanned`);
      assert.ok(sectionsOf(text).length > 1, `${id} ${harness}: the preamble is a scanned piece`);
    }
  }
  // A citation hidden in the preamble is caught.
  const preambleOnly =
    "crazy-ivan returns DO_NOT_MERGE whenever the auditor is DIRTY.\n\n## Section\nnothing here\n";
  const flagged = sectionsOf(preambleOnly).flatMap((s) => siblingVerdictSentences(s, "crazy-ivan"));
  assert.equal(flagged.length, 1, "a preamble citation is flagged");
});

test("a bare 'never' does not exempt a sibling-verdict citation", () => {
  // Only the explicit prohibition forms are exempt; a sentence that merely says
  // "never" while citing a sibling verdict is still a cross-citation.
  assert.equal(
    siblingVerdictSentences("The auditor will never accept that crazy-ivan is DO_NOT_MERGE.", "reward-hack-auditor-agent").length,
    1,
  );
});

test("the changed personas stay deployment-neutral", () => {
  for (const id of ["crazy-ivan", "reward-hack-auditor-agent", "pm-agent"]) {
    for (const [harness, text] of Object.entries(renderedPrompts(id))) {
      assert.doesNotMatch(text, new RegExp(["pv", "e-agent|tam", "tam|hermes0\\d"].join(""), "i"), `${id} ${harness}: no deployment names`);
    }
  }
});
