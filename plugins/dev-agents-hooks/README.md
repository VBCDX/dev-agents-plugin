# dev-agents-hooks

A Claude Code plugin that ships with the VBCDX dev agents. It adds two hooks to every
session where it is enabled.

| Hook | Event | What it does |
| --- | --- | --- |
| `credential-url-guard` | `PreToolUse` (Bash) | Denies a git command that carries credentials in a URL's userinfo: `https://user:pass@host`, `https://$TOKEN@host`, `https://"$U:$P"@host`, the same URL written into a `.git/config` by any command, or passed through `GIT_CONFIG_*`. Git copies such a URL into the argv of its transport helper, where `ps` shows it, and a clone writes it into `.git/config`. A plain username (`ssh://git@host`) is allowed. The deny message never repeats the URL. |
| `review-panel-reminder` | `PostToolUse` (Bash) | After `git push`, `git merge`, or creating or merging a pull request with `gh`, `tea` or `glab`, it tells the agent that the pull request needs independent verdicts at its exact head: review-agent, crazy-ivan and reward-hack-auditor-agent, plus security-agent or qa-agent when the change calls for them. It never blocks. |

Both are dependency-free Node.js scripts (Node 22 or later).

## Install

From the marketplace this repository declares (`.claude-plugin/marketplace.json`, named `vbcdx`):

```sh
claude plugin marketplace add VBCDX/dev-agents-plugin
claude plugin install dev-agents-hooks@vbcdx
```

Or load it for one session from a checkout:

```sh
claude --plugin-dir ./plugins/dev-agents-hooks
```

## Authenticating git without a URL credential

Let a credential helper supply the login instead, for example `git config credential.helper store`,
Git Credential Manager, or a per-clone helper: `git clone -c credential.helper="<helper>" URL DIR`.
