---
name: writing-issues-prs-reviews
description: House style for creating, updating, commenting on, closing, and reviewing issues AND pull requests on any git host — nomenclature, labels, and how to write in plain human language (self-contained, no jargon dumps or out-of-context code/log snippets) for a team where humans and agents work side by side. Use whenever filing/updating an issue or writing a PR description or review.
---

# Writing issues, PRs & reviews — house style

> This skill is host-, org-, and person-neutral. Anywhere it needs a specific
> name — your git host, your orgs, who signs off decisions, your labels — it
> reads it from a per-project context file. Copy `CONTEXT.example.md` (top of
> this catalogue) to `CONTEXT.md` in your project and fill it in; references
> below to "the context file" mean that file.

## Audience: humans and agents, side by side
Every issue, PR, comment, and review is read by **both people and agents**. Write for the human — plain, contextual, scannable — and keep the structure agents rely on (Refs, acceptance criteria, labels, PR/issue numbers, head shas, file paths). Neither audience is second-class: a person should follow the whole thread without a translator, and an agent should find the machine-usable facts without wading through prose. Never write agent-to-agent shorthand a human can't follow, and never bury the machine-usable anchors inside a wall of text.

## The one rule
Write the way a thoughtful human PM would: **plain language, self-contained, scannable.** Never a dense AI dump, a raw log/stack-trace/code paste, or a fragment that only makes sense if you read the whole thread. If a smart teammate who just walked in can't understand it, rewrite it.

## Before you touch an issue or PR
Fetch the **live** item (body + latest comments) first. Never write from a stale snapshot — state and labels go stale, and the last comment may already answer the question.

## Titles
- A short, specific noun phrase you can scan in a list of 50. Say the thing, not a category.
  - Good: `Saving an edited record returns a server error`
  - Bad: `bug` · `recordStore update $unset ERR-12266` · a branch name
- Decision tickets: prefix `DECISION (<decision-maker>): <the question in plain words>`, using the decision-maker name from the context file.
- Work items / PRs may use a light conventional prefix (`feat:`, `fix:`, `chore:`) — the rest is still human.

## Bodies — lead with context, in this order
1. **What this is** — one or two plain sentences.
2. **Why it matters / what's happening** — the impact, in human terms.
3. **What needs doing** (or, for a decision, **the options**).
4. **Recommendation** — your call and why.
5. **Cited facts** — prices, vendor terms, versions, links. Cite sources for anything external.

Self-contained: the reader should never need the thread, a chat log, or tribal knowledge to act. Short paragraphs and bullets, one idea per line. For work items, include acceptance criteria / what "done" looks like and the file paths involved.

## No out-of-context snippets
Don't paste raw stack traces, long code, or log walls. If a technical detail matters, **say it in a sentence and point at the file/line** — don't dump the output.
- Jargon dump (bad): *"PUT /records/:id 500s — server error on empty `$unset {}`; updateOwned attaches an unconditional `$unset` operator doc."*
- Human (good): *"Saving an edited record fails with a server error. Cause: when a save has nothing to remove, the update still sends an empty 'unset', which the database rejects. Fix: only send 'unset' when there's something to drop. See the record store module, `src/store/recordStore.js`."*
Expand acronyms on first use. Assume the reader is smart but not inside your head.

## Pull request descriptions & reviews
Same human voice as issues.
- **PR title:** what it does, plainly (`fix: saving an edited record no longer errors`) — not a branch name or a bare ticket id.
- **PR body, in order:** what changed and why (plain) → what a reviewer should focus on / the risky or subtle bits → how it was verified, in a sentence (*"tests + build green; smoke-checked the save flow"* — not a pasted CI matrix) → `Refs #N` (never `Closes` — see below).
- Call out where a reviewer should look, in words; point at files, don't paste diffs.
- **Review verdicts (human or agent):** state the verdict and the full head sha it's pinned to, then findings in plain sentences — *"Approved at `<sha>`. One non-blocking note: …"*. Blocking findings say what's wrong and how to fix, in human terms.
- Keep the machine anchors present and findable: PR number, full head sha, file paths, `Refs`.

## Decisions for the User
Some questions only a specific person can answer. For those:
- A **real ticket**, assigned to the decision-maker and labelled with the park label — both from the context file. Assign AND label: the assignment routes it to the right person, the label is the durable "waiting on a decision" signal automated sweeps and teammates rely on.
- A **`⚠️ DECISION NEEDED (<decision-maker>) — <date>`** block at the **top of the body**: what it is, the options with tradeoffs/cost, your recommendation, the cited facts. Never bury the question in a tail comment; on a long thread, prepend the block to the body.
- End with a plain "reply A/B/C" so acting on it is one line.

## Updates & comments
- Say **what changed and what's next**, in human terms: *"Merged and deployed to staging; next is the review panel on #560."* Not a paste of the CI matrix or a transcript.
- Status, not stream-of-consciousness — one update, the current state.
- **Closing:** one or two plain sentences — why it's closed and what shipped / where.

## Nomenclature (keep it consistent)
The rule is simple: **define your nomenclature once and use it consistently** — the same name for the same thing every time, glossed on first use so a newcomer can follow. Keep the actual list — your orgs/namespaces, your product and module names, your tenancy words (the unit that is your permission boundary) — in the project context file, not scattered across issues. Point at it; don't re-invent names per thread.

**`Refs` not `Closes`.** Git hosts (GitHub, GitLab, Gitea/Forgejo) auto-close an issue when a commit message on *any* branch says `Closes #N` / `Fixes #N` — including a feature branch that isn't merged yet. Use `Refs #N` in commits and PR bodies to link without closing, and close issues deliberately after verifying the work actually shipped. (Your host's exact auto-close keywords are noted in the context file.)

## Labels
- **Park label** (from the context file) — marks an item as waiting on the decision-maker; pair it with the assignment. This is the durable "needs a decision" signal.
- **Priority labels** (from the context file) — use sparingly, only when true.
- Prefer **few meaningful labels** over a pile.

## Quick check before you submit
- Could a teammate who just joined — or an agent picking this up cold — act on it without asking you a question?
- Is the ask / decision at the TOP, not buried?
- Did you say the technical bit in a sentence instead of pasting output?
- Human voice, not a machine-generated technical excerpt — and are the machine anchors (numbers, sha, file paths, Refs) still findable?
