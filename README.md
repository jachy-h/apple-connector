# Apple Connector

[中文](README_zh.md)

Apple Connector is a local stdio MCP server for Apple Calendar and Reminders. It runs only on your Mac: there is no HTTP, LAN, or cloud endpoint.

It currently supports macOS on Apple Silicon (arm64) and Node.js 24.20.x or 26.8.x. Apple Notes is unavailable.

## Install and connect

```sh
npm install -g @jachy/apple-connector
apple-connector agent init
```

`agent init` creates local state, a reviewable policy, and an owner-only credential file before printing a ready-to-merge MCP server entry. Merge only that `apple-connector` entry into your host's MCP configuration; do not replace existing settings. Restart or reload the host, then verify with read-only tools.

The default policy permits reading every Calendar and Reminders container. Only a uniquely named `Agents` calendar or list receives write permissions. Missing or duplicate `Agents` containers reject writes safely.

## Give this to your Agent

Copy the following instruction into an Agent that is configuring your local MCP host:

```text
On this Mac, set up Apple Connector as a stdio MCP server. Check that macOS is Apple Silicon and Node is 24.20.x or 26.8.x. Install @jachy/apple-connector@0.8.3 globally, then run `apple-connector agent init`. Do not read, print, copy, or put token contents in configuration; use only the generated absolute credential-file path. Merge the printed `mcpServers.apple-connector` entry into the existing host configuration without replacing other entries. Reload the host and verify only with `connector.capabilities`, `calendar.list_calendars`, and `reminders.list_lists`; do not write Apple data for setup. Report any missing permission, unsupported platform, or duplicate/missing Agents container instead of guessing.
```

For a detailed host-neutral procedure, give the Agent the [integration guide](docs/agent-mcp-install.md). For manual pairing, custom policy, and troubleshooting, see the [MCP setup guide](docs/mcp-setup.md).

## Agent tools

| Purpose | Tools |
| --- | --- |
| Read calendars and events | `calendar.list_calendars`, `calendar.list_events` |
| Manage non-recurring events | `calendar.create_event`, `calendar.update_event`, `calendar.delete_event` |
| Read reminder lists and reminders | `reminders.list_lists`, `reminders.list` |
| Manage non-recurring reminders | `reminders.create`, `reminders.update`, `reminders.complete`, `reminders.delete` |
| Recover a mutation result | `operations.get` |

Every write needs a stable `idempotencyKey`. If a result is lost, query its operation ID or retry with the identical key and request; do not issue a fresh write. macOS privacy permissions and the connector policy are separate restrictions.

## Development and release

Run `npm ci`, `npm run check`, `npm run check:jxa`, and `npm run release:verify` from a source checkout. The latter audits the npm tarball as well as built artifacts.

v0.8.3 is prepared for the first npm release. Publication remains blocked until the maintainer selects a license. See the [release plan](docs/v0.8.3-plan.md) and [progress record](docs/v0.8.3-progress.md).
