# Getting started

[中文](getting-started_zh.md) · English

This guide is for the person using the Mac. The Agent does not create permissions or authorizations for you.

1. **Install the CLI.** In this project run `npm link`, or install the published package with `npm install -g @jachy/apple-connector`. Confirm with `apple-connector version`. The project must run on the same Apple Silicon Mac that will access Calendar or Reminders, with macOS 14+ and a supported Node version. For a source build, create the signing identity once, run `npm ci && npm run build`, then `npm link`; see [Signing](signing.md).
2. **Run `apple-connector init`.** It initialises `~/.apple-connector`, starts or reuses the local service, opens the local management page, and prints a loopback URL that expires after one hour. Re-running it later behaves like `open`.
3. **Step 1 – System access.** On the setup page, request Calendar and/or Reminders access. The macOS prompt names **Apple Connector**; choose full access. Step 2 stays locked without full access. See [System permissions](system-permissions.md) for status meanings and troubleshooting.
4. **Step 2 – Authorize one Agent.** Select the containers and actions for one Agent. Expiry defaults to one year and can be changed. An authorization cannot be edited after creation; delete and recreate it to change scope.
5. **Step 3 – Copy the prompt.** The page lists every non-revoked authorization with its prompt. For the authorization you just created, the recommended prompt uses the authorization key and does not contain the authorization ID; the local CLI resolves the owner-only credential itself. Existing authorizations show the recommended prompt only, because the authorization ID is returned once at creation. Copy the prompt for the Agent you are connecting. Use the fallback prompt with the authorization ID only when the key cannot be used.
6. **Step 4 – Agent verification.** The Agent loads the packaged Skill, runs `auth verify --agent <name>` to bind, then performs one bounded read-only query. Run `auth show` when the name, scope or expiry is needed. The setup page refreshes automatically and shows “Agent bound” with the verification time.

The management page lists visible containers by name and stable ID. The authorization ID is shown once and is also written to an owner-only local credential file. Never paste the fallback prompt or authorization ID into a chat you do not trust.

Since v0.17.0, Calendar/Reminders permission belongs to `AppleConnector.app`, not to Terminal or your agent host. Upgrading from v0.16.x or earlier requires one new grant on the setup page. Rebuilding with the same signing identity keeps the grant; see [Signing](signing.md).

The Usage guide tab has the full command reference, examples and troubleshooting, and `apple-connector help` or `apple-connector help <topic>` works from the terminal. To change macOS access, use System Settings → Privacy & Security → Calendar or Reminders. If the link expires, run `apple-connector init` again. Use `apple-connector open --section <setup|audit|docs>` for later management; the legacy `permissions` and `agents` values still open the setup page. Do not expose loopback ports, and do not retry an `outcome_unknown` write with a new key.

See the [documentation index](README.md) for the CLI, Skill, signing, permission and upgrade references.
