# Skill workflow

[中文](skill_zh.md) · English

Install the directory reported by `apple-connector skill path --json` using the host's documented Agent Skills mechanism. The Skill uses standard `name` and `description` frontmatter and does not depend on a particular host. The packaged file is [skill/SKILL.md](../skill/SKILL.md).

If the host cannot persist Skills, the Agent may read `SKILL.md` for the current session and state that limitation honestly. When the user pastes an Agent prompt, the Agent should load the Skill with `skill path`, prefer the `Authorization key` / `授权 key` with `--auth-key`, complete the binding with `auth verify --agent <name>`, and perform one bounded read-only query. The CLI resolves the owner-only credential; do not read, copy, scan or print token files in the profile directory. Older prompts may provide a `Credential file` path (`--auth-file`) or an authorization ID; store an authorization ID in a secret store or an owner-only mode `0600` file and never echo it. Use `auth show` when the name, scope or expiry is needed. The setup page observes that binding automatically. Do not scan the state or profile directory for tokens or poll the management page.

Since v0.17.0 the macOS Calendar/Reminders permission belongs to the Apple Connector App. If the setup page reports `not_determined`, `denied` or `restricted`, the human must grant it there or in System Settings; do not request Full Disk Access. `permission_denied` can mean either a missing system permission or an authorization that is too narrow. See [System permissions](system-permissions.md).

Updating means installing the desired CLI version, resolving `skill path` again, and refreshing the host's Skill import. Revoking an Agent means deleting its authorization on the setup page; deleting the authorization invalidates the token immediately and retains the audit history.

## Related

- [Getting started](getting-started.md) — the human setup flow.
- [Agent installation](install-for-agent.md) — checks an Agent runs before onboarding.
- [CLI reference](cli.md) — every command and option.
- [Documentation index](README.md) — all guides and version history.
