# @vbcdx/dev-agents-plugin

The **dev agent pack** for [vbcdx](https://github.com/VBCDX/vbcdx): sixteen development roles,
each one canonical prompt plus a machine-readable role descriptor, and the skills they use.
`vbcdx` installs them into **Claude Code**, **Codex**, **OpenCode** or **Hermes Agent**, binds
each role to the MCP tools its descriptor allows, and layers your team's own process on top
through overlays.

This package holds no installer and runs nothing. It is data: `vbcdx-pack.json`,
`assets/roles/<id>/{prompt.md,role.json}` and `skills/`.

## Install

```sh
npm install -g @vbcdx/vbcdx @vbcdx/dev-agents-plugin
vbcdx packs                                              # the packs found, with their roles
vbcdx install agent code-agent,review-agent --harness=claude
vbcdx install skill writing-issues-prs-reviews --harness=claude
```

Roles work with **no service credentials at all**: remote capabilities appear only when you
register a tool package (`vbcdx install tool @vbcdx/forgejo-plugin`, `@vbcdx/coolify-plugin`)
and bind a role to it. See the vbcdx README for harnesses, credentials and options.

## Roles

| id | Role | Kind | May merge | Services |
|----|------|------|-----------|----------|
| `all-in-one-dev-agent` | All-in-One Dev Agent: carries the whole loop, issue to PR | generalist | no | Forgejo, Coolify |
| `code-agent` | Code Agent: implements issues on their own branch, PR-first | implementer | no | Forgejo |
| `copywriter-content` | Long-form content drafts (blog, scripts, case studies) | author | no | Forgejo |
| `copywriter-marketing` | Short-form marketing and UX copy, N≥3 variants | author | no | Forgejo |
| `crazy-ivan` | Exact-head adversarial auditor of a PR and its review | inspector | no | Forgejo |
| `designer-agent` | Advisory UX and accessibility review | author | no | Forgejo |
| `devops-agent` | Infrastructure as code; live changes only with approval | implementer | no | Forgejo, Coolify |
| `instructional-designer-agent` | Workshop curricula and facilitator materials | author | no | Forgejo |
| `market-research-agent` | Technology research with cited sources | inspector | no | Forgejo |
| `pm-agent` | Orchestrator: issues, delegation, verdicts, merges | coordinator | **yes** | Forgejo, Coolify |
| `qa-agent` | E2E, integration and deployment smoke tests | implementer | no | Forgejo, Coolify |
| `review-agent` | Evidence-grounded PR review (AC table per review) | inspector | no | Forgejo |
| `reward-hack-auditor-agent` | Pre-merge audit for masked gates and dropped criteria | inspector | no | Forgejo |
| `security-agent` | Security audits with version-matched citations | inspector | no | Forgejo, Coolify |
| `user-research-agent` | Proxy UX testing of a live deployment | inspector | no | Forgejo |
| `video-creator` | Shot plans, generated clips and assembled cuts | author | no | Forgejo |

Each `role.json` names the exact MCP tools the role may call (`remote_capabilities`), whether
it may write files or run a shell, and its web-search access. "May merge" is a stance the
descriptor records; the token's own scopes are what enforce it.

## Skills

- `writing-issues-prs-reviews` (`skills/development/VBCDX-ISSUES.MD`): how to write issues,
  pull requests and reviews for a team where humans and agents work side by side.
- `skills/CONTEXT.example.md`: the per-project context file the skills read (your git host,
  teams, labels, who decides). Copy it to `CONTEXT.md` and fill it in.

## Adding your team's process: overlays

The prompts are generic. Where a team decides something for itself, a prompt marks a **slot**,
`<!-- vbcdx:slot <name> -->neutral default<!-- /vbcdx:slot -->`, or uses a **variable**,
`{{vars.<name>}}`, declared with a neutral default in `vbcdx-pack.json`. An overlay directory
fills them without forking the pack:

```
my-overlay/
  vbcdx-overlay.json             { "schema_version": 1, "name": "my-team", "version": "1.0.0",
                                   "packs": ["dev-agents"], "vars": { "review_standards": "…" } }
  slots/<role>/<name>.md         your text for one role's slot
  slots/<name>.md                your text for that slot in every role that has it
  roles/<role>.md                appended to one role
  all.md                         appended to every role
```

```sh
vbcdx install agent code-agent --harness=claude --overlay=/abs/path/my-overlay
```

The slots this pack marks, by theme:

| Theme | Slots |
|-------|-------|
| Workspace and test runs | `workspace`, `workspace-end`, `test-cap`, `ci`, `readonly-git` |
| Branch, commit and issue conventions | `branch`, `commits`, `issue-linking`, `issue-link`, `checklist-conventions`, `git-hygiene` |
| Progress notes | `milestones`, `blocked-note`, `terminal-signal`, `spawn-id` |
| Voice, personas, offering | `voice`, `personas`, `offering`, `session-formats`, `cta-examples`, `we-example`, `case-example`, `authenticity-examples` |
| Environment and media | `environment`, `environment-principle`, `environment-cost`, `media-backends`, `quality`, `assembly`, `vendor-docs` |
| Review panel (the two auditors) | `verdict-grammar`, `panel`, `cross-citation`, `finding-routing`, `gate-intro`, `completion-step` and related |
| Orchestration (pm-agent) | `process` |

Variables: `review_standards`, `issue_management`, `human_account`, `park_label`
(see `vbcdx-pack.json` for each default). An unknown slot or variable in an overlay is an error,
reported by name before anything is written.

## Claude Code hooks plugin

[`plugins/dev-agents-hooks`](plugins/dev-agents-hooks/) is a Claude Code plugin with two
guardrails for sessions that run these agents: a `PreToolUse` hook that denies git commands
carrying credentials in a URL, and a `PostToolUse` reminder that a pull request needs its
review panel (review-agent, crazy-ivan, reward-hack-auditor-agent) at the exact head. This
repository is also a plugin marketplace named `vbcdx` (`.claude-plugin/marketplace.json`):

```sh
claude plugin marketplace add VBCDX/dev-agents-plugin
claude plugin install dev-agents-hooks@vbcdx
```

## Development

```sh
npm ci
npm test
```

`assets/roles/` is the source of truth. `role.json` files are generated from
`scripts/source-agent-cards.json` and the capability table in `scripts/derive-roles.mjs`
(`node scripts/derive-roles.mjs`; commit the regenerated files with any change to either). The tests load the pack with
vbcdx's own loader and overlay composer, vendored under `test/vendor/vbcdx`.

## License

[MIT](LICENSE)
