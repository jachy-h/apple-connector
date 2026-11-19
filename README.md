# Apple Connector

Apple Connector is a local CLI for Apple Calendar and Reminders. It runs only on your Mac: the management page binds to loopback and expires after one hour; there is no LAN, cloud, or MCP endpoint.

> **Distribution status:** No standalone `.app` download, DMG or Homebrew Cask is offered. Install Apple Connector from npm or a local source build; public notarized distribution is deferred. See the [distribution decision](docs/distribution-decision.md).

State lives in `~/.apple-connector`; if you are upgrading from a build that used `~/apple-connector`, run `apple-connector migrate-state` once.

Since v0.17.0 the EventKit helper runs inside a self-signed `AppleConnector.app`. macOS records Calendar/Reminders permission for **Apple Connector**, not for Terminal or your agent host, and the grant survives upgrades that keep the signing identity. See [system permissions](docs/system-permissions.md) and [signing](docs/signing.md).

## For people: connect in four steps

1. **Install the CLI** with `npm link` from this project, or `npm install -g @jachy/apple-connector`. Confirm with `apple-connector version`. For a source build, create the self-signed signing identity once ([signing](docs/signing.md)), run `npm ci && npm run build`, then `npm link`.
2. **Run `apple-connector init`.** It initialises local state, starts or reuses the service, opens the local management page, and expires after one hour. Re-running it later behaves like `open`.
3. **Complete authorization on the setup page.** Step 1 grants macOS access (the prompt names **Apple Connector**); step 2 creates one authorization for one Agent with Calendar and Reminders containers and actions; step 3 lists every authorization and copies its prompt.
4. **Let the Agent verify.** Paste the prompt into the Agent. After it runs `apple-connector auth verify --agent <name>`, step 4 on the setup page shows "Agent bound" immediately.

When a new authorization is created, the page offers two prompts:

- **Recommended:** uses the authorization key and does **not** contain the authorization ID; apple-connector resolves the owner-only credential on this Mac itself. Copy this prompt to your Agent.
- **Fallback:** contains the authorization ID. Use it only when the authorization key cannot be used; it will remain in the chat history.

Existing authorizations show the recommended prompt only, because the authorization ID is returned once at creation. An authorization is immutable after creation; delete and recreate it to change scope. Use `apple-connector open` later for setup, audit, or the usage guide. If the page expires, run `apple-connector init` again.

Upgrading from v0.16.x or earlier changes the permission owner to Apple Connector, so grant Calendar/Reminders once more on the setup page. The old Terminal/OpenCode entries are no longer used.

## For Agents

Apple Connector works with an Agent running locally on the same Apple Silicon Mac (macOS 14+, supported Node version). It is host-neutral: an Agent only needs to run the CLI and read the packaged [Skill](skill/SKILL.md).

When the user pastes an onboarding prompt:

1. Load the packaged Skill and follow its rules: `apple-connector skill path --json`.
2. Run `apple-connector auth verify --agent '<your name>' --auth-key '<key>' --json` to complete the binding; the local setup page shows "Agent bound" immediately. The authorization key is a local profile identifier, not a bearer secret: pass it with `--auth-key` and let the CLI resolve the credential. Do not read, copy, scan or print token files in the profile directory. If the prompt contains an authorization ID instead, store it in the host Agent's secret store or an owner-only mode `0600` file, pass it through `APPLE_CONNECTOR_AUTH` or `--auth-file`, and never echo it. An older prompt may contain an explicit `Credential file` path; pass it with `--auth-file` without reading or printing it. Run `apple-connector auth show --auth-key '<key>' --json` when you need the authorization name, scope or expiry.
3. Verify with one bounded read-only query: `calendar list-calendars` or `reminder list-lists`.

If the prompt is missing or expired, ask the user to run `apple-connector init` again. Do not scan the state or profile directory for tokens or call business commands before authorization is verified.

For the full routes, see [Getting started](docs/getting-started.md), [Agent installation](docs/install-for-agent.md), [System permissions](docs/system-permissions.md), [Signing](docs/signing.md), [Skill reference](docs/skill.md), and the [CLI reference](docs/cli.md).

All machine-facing commands use `--json`; writes require an idempotency key and an authorization ID. See the [upgrade guide](docs/v0.8-to-v0.9-migration.md).

## Documentation

- [Documentation index](docs/README.md) — every guide and the full version history
- [Getting started](docs/getting-started.md) · [中文](docs/getting-started_zh.md)
- [CLI reference](docs/cli.md) · [中文](docs/cli_zh.md)
- [System permissions](docs/system-permissions.md) · [中文](docs/system-permissions_zh.md)
- [Signing without an Apple Developer account](docs/signing.md) · [中文](docs/signing_zh.md)
- [Skill reference](docs/skill.md) · [中文](docs/skill_zh.md)
- [Distribution decision](docs/distribution-decision.md)
