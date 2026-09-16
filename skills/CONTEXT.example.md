# Project context (example)

Copy this file to `CONTEXT.md` in your own project and fill in every `<…>`
blank. The skills in this catalogue are written to be host-, org-, and
person-neutral; they read the specifics — your git host, your teams, who signs
off decisions, your labels — from this one file so the skill itself never has to
name them. Keep this file as the single place those facts live, and they stay
consistent everywhere.

None of the values below are real: they are placeholders. Replace them.

## Git host

- **Host:** `<your git host, e.g. github.com / gitlab.com / your self-hosted URL>`
- **Auto-close keywords:** `<Closes / Fixes>` — most hosts (GitHub, GitLab,
  Gitea/Forgejo) auto-close an issue when a commit message on *any* branch
  contains one of these followed by the issue number. This is why the skills
  say to write `Refs #N` instead when you only want to link, not close.

## Organizations / namespaces

List the org or namespace names a reader will see in URLs and references, and
one line on what each is:

- `<org-one>` — `<what it is>`
- `<org-two>` — `<what it is>`

## Product nomenclature (define once, keep consistent)

The names of your products, modules, and services, each with a one-line gloss so
a reader who just joined can follow a thread without a translator:

- `<Module A>` — `<what it is>`
- `<Module B>` — `<what it is>`
- **Tenancy words:** `<e.g. organization / workspace>` — name the unit that is
  your permission boundary, and use it consistently.

## Decisions

For questions only a specific person can answer:

- **Decision-maker identity (assignee):** `<username>` — the account a decision
  ticket is assigned to.
- **Park label:** `<e.g. blocked for user>` — the label that marks a ticket as
  waiting on that person. Assign *and* label: the assignment routes it, the
  label is the durable "needs a decision" signal.
- **Decision block heading:** `DECISION NEEDED (<decision-maker>)` — the heading
  that goes at the top of a decision ticket's body.

## Priority labels (use sparingly, only when true)

Your few high-signal priority labels — not a pile:

- `<priority/p0-critical>`
- `<priority/p1-high>`
