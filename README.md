# @vbcdx/dev-agents

Installer for the sixteen canonical VBCDX development agents. One canonical
prompt and machine-readable role descriptor per role, rendered deterministically
for **DSH**, **Claude Code**, **Codex**, and **OpenCode**. Installing useful
agents with **no service credentials at all** is a first-class, supported mode.

This package does **not** install, register, start, or configure Forgejo,
Coolify, or any other MCP server — those companion packages own their own server
configuration, authentication, and tool schemas. This package materializes agent
definitions and, when explicitly supplied, writes per-role credential files.

## Requirements

- Node.js **>= 20** (CI covers 22 and 24).
- A POSIX host. The filesystem-safety guarantees (0600/0700 modes, ownership,
  symlink refusal, atomic rename) require POSIX semantics; other platforms are
  unsupported in v1.

## Install

```sh
npm install -g @vbcdx/dev-agents
```

This provides the `vbcdx-dev-agents` executable.

## Command

```
vbcdx-dev-agents init --harness=<dsh|claude|codex|opencode> --env=<absolute-config-path>
                      [--agents=<comma,separated,canonical,ids>]   # default: all sixteen
                      [--scope=<user|project>]                     # default: user (not for dsh)
                      [--profile=<name>]                           # dsh only, default: web
                      [--force] [--dry-run] [--quiet]
vbcdx-dev-agents --help
vbcdx-dev-agents --version
```

- `--harness` and `--env` are required. **No credential or endpoint value is
  ever accepted on the command line.**
- `--agents` accepts comma-separated **canonical** IDs (source aliases such as
  `all-tools` are rejected); it trims whitespace, rejects empty/unknown items,
  and deduplicates while preserving order. Default is all sixteen.
- `--scope` is `user` (default) or `project` for Claude/Codex/OpenCode. Project
  scope writes into the containing Git worktree and fails if there is none. DSH
  rejects `--scope`.
- `--profile` is DSH-only and defaults to `web`; other harnesses reject it.
- `--force` authorizes replacing conflicting **generated** content after all
  safety checks; it never bypasses ownership, permission, symlink, schema, or
  dependency validation, and never overwrites a valid existing credential file
  without also passing every credential safety check.
- `--dry-run` parses, validates, and plans only: it writes no files, takes no
  locks, and runs no child process, harness, or model.
- `--quiet` suppresses routine progress but never errors, conflicts, skipped
  capabilities, pending DSH boot, or incomplete verification.

## The literal configuration file

The `--env` file is read **literally**. It is never sourced, executed, or
interpolated: a `$VAR`, a `~`, or a `$(...)` stays literal, and ambient
environment variables are never used as defaults. See
[`.env.example`](./.env.example) for the full grammar and every supported key.

Minimal credential-free config:

```
VBCDX_AGENTS_BASE_DIR=/home/you/.local/state/vbcdx-agents
VBCDX_AGENTS_CREDENTIALS_DIR=/home/you/.config/vbcdx/credentials
VBCDX_AGENTS_CLAUDE_CONFIG_DIR=/home/you/.config/claude
```

`VBCDX_AGENTS_BASE_DIR` and `VBCDX_AGENTS_CREDENTIALS_DIR` are always required.
Only the **selected** harness's root key is required (and only for DSH or `user`
scope); `project` scope uses the worktree instead.

## Per-harness installation and launch

Installer root keys are **not** the harness's own environment variables. For
`user` scope, `init` prints a `launch environment` block; export exactly those
variables before starting the harness. The translations are:

| Installer key | Harness launch variable |
| --- | --- |
| `VBCDX_AGENTS_DSH_HOME` | `DSH_HOME` |
| `VBCDX_AGENTS_CLAUDE_CONFIG_DIR` | `CLAUDE_CONFIG_DIR` |
| `VBCDX_AGENTS_CODEX_HOME` | `CODEX_HOME` |
| `VBCDX_AGENTS_OPENCODE_CONFIG_DIR` | `OPENCODE_CONFIG_DIR` |

### Claude Code

```sh
vbcdx-dev-agents init --harness=claude --env=/abs/config.env --scope=user
# then launch Claude Code with the printed CLAUDE_CONFIG_DIR exported:
CLAUDE_CONFIG_DIR=/home/you/.config/claude claude
```

- User scope writes `<CLAUDE_CONFIG_DIR>/agents/<id>.md`.
- Project scope (`--scope=project`) writes `<worktree>/.claude/agents/<id>.md`;
  launch Claude Code from that project.

### Codex

```sh
vbcdx-dev-agents init --harness=codex --env=/abs/config.env --scope=user
CODEX_HOME=/home/you/.codex codex
```

- User scope writes `<CODEX_HOME>/agents/<id>.toml`; project scope writes
  `<worktree>/.codex/agents/<id>.toml`. Codex delegation uses its native agent
  type.

### OpenCode

```sh
vbcdx-dev-agents init --harness=opencode --env=/abs/config.env --scope=user
OPENCODE_CONFIG_DIR=/home/you/.config/opencode opencode
```

- User scope writes `<OPENCODE_CONFIG_DIR>/agents/<id>.md`; project scope writes
  `<worktree>/.opencode/agents/<id>.md`. `OPENCODE_CONFIG_DIR` *adds* a search
  directory — it does not disable your ordinary global/project OpenCode config,
  so definitions from both are merged. `pm-agent` and `all-in-one-dev-agent` use
  `primary` mode; the rest use `all` mode.

### DSH (staged, then booted)

DSH is not written to a live instance by `init`. Instead `init` **stages** the
rendered assets and a versioned plan under
`<BASE_DIR>/installations/dsh/<profile>/`, then attempts to register this package
as a native DSH plugin:

```sh
vbcdx-dev-agents init --harness=dsh --env=/abs/config.env --profile=web
```

- If the `dsh` CLI is present, the package is registered and materialization
  happens on the **next operator-controlled DSH boot** (`init` never boots or
  restarts a live DSH instance).
- If `dsh` is not present, staging still completes and the output says the
  registration is pending; run it on the DSH host later.
- At boot, exactly the staged plan is materialized to
  `<DSH_HOME>/.agent-presets/<id>/{preset.yml,agent.cordis.yml}` through the same
  safe writer and ownership rules as every other managed file.

## Credential-free vs. integrated installs

**Credential-free (recommended starting point).** Leave every credential triple
blank/absent. All sixteen agents install and load; their Forgejo/Coolify
capabilities are simply unavailable until an integration is bound. This mode
never creates placeholder files and never infers credentials.

**Per-role credentials.** For an enabled role, set `VBCDX_AGENTS_USER_<SUFFIX>`
plus at least one of `VBCDX_AGENTS_TOKEN_<SUFFIX>` / `VBCDX_AGENTS_PASSWORD_<SUFFIX>`
in the config file. The suffix is the canonical ID uppercased with hyphens as
underscores (`code-agent` → `CODE_AGENT` — note: `CODE_AGENT`, not `CODER_AGENT`).
Leaving all three blank disables that role's remote access. A complete triple
writes `<CREDENTIALS_DIR>/<role>.env` at mode `0600` in a `0700` directory,
owned by you. A valid existing credential file is **retained** (not overwritten)
without `--force`; `--force` replaces it only after every safety check passes.

**Integrations (MCP tool bindings).** Point `VBCDX_AGENTS_INTEGRATIONS_FILE` at
one absolute, non-secret JSON file describing which services are bound, where
each service's exported manifest lives, and each role's explicit credential-file
path:

```json
{
  "schema_version": 1,
  "services": {
    "forgejo": {
      "server_name": "forgejo",
      "manifest_file": "/home/you/.config/vbcdx/manifests/forgejo.json",
      "credentials": { "code-agent": "/home/you/.config/vbcdx/forgejo/code-agent.env" }
    },
    "coolify": {
      "server_name": "coolify",
      "manifest_file": "/home/you/.config/vbcdx/manifests/coolify.json",
      "credentials": { "devops-agent": "/home/you/.config/vbcdx/coolify/devops-agent.env" }
    }
  }
}
```

### MCP prerequisites

- The companion server packages (e.g. `@vbcdx/forgejo`, `@vbcdx/coolify`) own the
  MCP server registration, endpoint (`VBCDX_FORGEJO_URL` / `VBCDX_COOLIFY_URL`),
  and authentication. This installer never edits harness MCP configuration.
- Each companion exposes a `manifest` command; save its output as the
  `manifest_file`. Supported contracts are `vbcdx.forgejo/1` and
  `vbcdx.coolify/1`. The installer validates the service, contract, tool
  names/schemas, and role mappings **offline** — offline agreement proves
  interface compatibility, not live registration.
- A tool binds only when it is in **both** the role's reviewed allowlist and the
  service manifest, **and** the role has an explicit credential-file mapping for
  that service. Bindings never widen to a wildcard.
- A Forgejo credential file requires `ROLE`, `USER`, and `TOKEN` and/or
  `PASSWORD`. A separately provisioned Coolify file requires `ROLE` and `TOKEN`
  (`USER`/`PASSWORD` are ignored by that service). A mapping alone never creates
  a credential file; the installer either writes the planned file or validates a
  separately provisioned one read-only.
- After adding or changing an integration, rerun `init` explicitly. Generated
  bindings are reported as offline-rendered; runtime MCP `tools/list` schemas and
  native names are verified separately (see *Runtime verification*).

## Native destinations

| Harness | Destination |
| --- | --- |
| DSH | staged under `<BASE_DIR>/installations/dsh/<profile>/`, materialized to `<DSH_HOME>/.agent-presets/<id>/` at boot |
| Claude (user / project) | `<CLAUDE_CONFIG_DIR>/agents/<id>.md` / `<worktree>/.claude/agents/<id>.md` |
| Codex (user / project) | `<CODEX_HOME>/agents/<id>.toml` / `<worktree>/.codex/agents/<id>.toml` |
| OpenCode (user / project) | `<OPENCODE_CONFIG_DIR>/agents/<id>.md` / `<worktree>/.opencode/agents/<id>.md` |

## Updates and conflicts

A versioned manifest under `<BASE_DIR>/manifests/installation.json` records each
generated file's last-written digest, mode, owning package version, and role. On
a rerun:

- **identical** content is a no-op (after safety validation);
- a **missing** package-owned file is repaired even at the same version;
- a package-owned file that still matches its recorded digest is updated to new
  content;
- a file that was **hand-edited** or is **not package-owned** is a **conflict**
  (exit 5) and is left untouched unless you pass `--force`.

The installer never recursively removes a preset directory, user-added files, or
unselected agents. A corrupt or foreign manifest fails conservatively rather than
claiming ownership. Credential-file retention follows its own rules above and is
never swept up in generated-file upgrades.

## Exit codes

`0` success · `2` CLI/config syntax, unsupported values, invalid paths or role
selection · `3` credential validation · `4` filesystem safety, permissions,
ownership, lock, or write failure · `5` generated-content conflict, unsupported
native scope, or known dependency/harness incompatibility · `6` native
subprocess failure or timeout.

## Runtime verification and supported-version limits

`init` reports only what it can prove offline: a written file proves *written*,
never that a harness discovered or loaded it, and `init` never makes a paid model
call to assert runtime success. The following are **explicit release gates**
proven separately by independent runtime testing (issue #3), not by this
installer:

- a real scratch DSH profile proving native registration, plan handoff,
  selected-only materialization, safe repeated boot, and the live preset mount;
- at least one real agent invocation per harness/scope with the expected
  persona/policy, and discovery of all sixteen definitions through a native
  interface where one exists.

Native interfaces were implemented against their documented references
(Claude sub-agents, Codex subagents, OpenCode agents/config). Concrete supported
versions are pinned by the issue #3 compatibility matrix; an unresolved DSH mount
or unsupported required scope remains an explicit gate, not a passing status.

## Development

```sh
npm ci
npm test
```

Canonical prompts and role descriptors under `assets/roles/` are the single
source of truth; the four renderers derive from them deterministically.
`scripts/derive-*.mjs` document how the assets were ported from
`VBCDX/dsh-agents` and are not part of the published runtime.

## License

MIT
