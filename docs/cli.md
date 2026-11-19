# CLI reference

[中文](cli_zh.md) · English

`apple-connector` is the sole public integration entry point in v0.17.0. All machine-facing commands accept `--json` and write one versioned JSON envelope to stdout (`schemaVersion: 2`).

State (SQLite database, admin token, authorization token files, audit and logs) lives in `~/.apple-connector` by default. `APPLE_CONNECTOR_STATE_DIR` overrides it for tests or temporary instances. Upgrading from a build that used `~/apple-connector`: run `apple-connector migrate-state` to stop the legacy service/web and move the directory. Other state commands also migrate automatically when the legacy service is not running.

Run `apple-connector help` for the overview, or `apple-connector help <topic...>` for detailed options and examples (for example `apple-connector help calendar create`). `--help`/`-h` and `--version`/`-v` are aliases for the same commands. Human-readable output uses color on a TTY; `--json`, `--no-color`, `NO_COLOR` and non-TTY output contain no ANSI. Business calls use an authorization key via `--auth-key <key>`, which resolves `<state dir>/profiles/<key>.token`; `--auth-file <path>` reads an explicit owner-only file, and `APPLE_CONNECTOR_AUTH` / `--auth <token>` pass the token directly. Legacy `--profile <key>` and `--credential-file <path>` still work. Writes require `--idempotency-key`. Put sensitive content in an owner-only `--input` JSON file.

`apple-connector init [--json]` is the human first-run entry point. It initialises state, starts or reuses the service, starts or reuses the one-hour management page, opens the setup page, and returns `{ url, expiresAt, remainingSeconds, section }`. In `--json` mode it does not open a browser. `apple-connector open [--section setup|audit|docs]` opens a management section later; the legacy values `permissions` and `agents` are accepted and normalised to `setup`.

`apple-connector skill path --json` returns the absolute packaged Skill directory and package version. `apple-connector auth show --auth-key <key> --json` describes the authorization behind a local profile without printing its token. `apple-connector auth verify --agent <name> --auth-key <key> --json` authenticates with the same profile and records the Agent name and verification time on the authorization; the setup page shows the binding immediately.

After the user creates an authorization, the page generates an Agent prompt. The recommended prompt contains only the authorization key and no token; pass it with `--auth-key <key>` and never read, scan or print token files in the profile directory. The fallback prompt contains the authorization ID; treat it as a bearer secret, store it in a secret store or mode `0600` file, and pass it via `--auth-file` or `APPLE_CONNECTOR_AUTH`. It is not printed by any CLI command. An older prompt may contain an explicit `Credential file` path; `--auth-file <path>` continues to work.

## Service lifecycle

`init` and `open` start the service if needed. `start` starts the detached Node service and the permission-owning helper App; `start --foreground` keeps the Node service in the current terminal; `stop` stops both; `status` reports the service and helper state. Since v0.17.0 the helper runs as `dist/native/AppleConnector.app`, so macOS records Calendar/Reminders permission for Apple Connector rather than the launching terminal. The App and the Node service communicate over `<state dir>/helper.sock` using the existing JSONL protocol.

`doctor` reads the helper permission over that socket and also reports the JXA probe separately. The JXA probe runs through `osascript` and reflects the process that launched the CLI, not the Apple Connector App. `APPLE_CONNECTOR_HELPER_MODE=direct` starts the helper directly for tests, CI and headless troubleshooting; in that mode permission follows the host app again.

`status` adds a `helper` object to its JSON output (`running`, `pid`, `socket`) and a `health` object. The helper is running only when both its pid file and socket are present. If `status` says the helper is stopped while the service is running, run `start` again or inspect `<state dir>/helper.log`.

### Command summary

| Command | Purpose |
| --- | --- |
| `init`, `open`, `start`, `stop`, `status` | Local service and management page lifecycle |
| `doctor [--probe]` | Version, platform, helper permission (and the host-bound JXA probe) |
| `skill path` | Absolute packaged Skill directory and package version |
| `auth show`, `auth verify` | Inspect or bind the authorization behind a local profile |
| `calendar list-calendars`, `calendar list` | Read containers and events |
| `calendar create`, `update`, `delete` | Event writes |
| `reminder list-lists`, `reminder list` | Read lists and reminders |
| `reminder create`, `patch`, `update`, `complete`, `delete` | Reminder writes |
| `operation get` | Look up a durable operation record after `outcome_unknown` |
| `migrate-state` | Move the legacy `~/apple-connector` state directory |

Run `apple-connector help <command>` for the exact options of this version.

## Reminders

`reminder list` returns each item with `due` and `recurring`. `due` is `null` or one of:

```json
{"kind":"date","date":"2026-11-20"}
{"kind":"floating","date":"2026-11-20","time":"17:00:00"}
{"kind":"instant","at":"2026-11-20T17:00:00+08:00","timeZone":"Asia/Shanghai"}
```

- `date` is an all-day due with no time zone.
- `floating` is a wall-clock due with no time zone.
- `instant` is a zoned due. The same local EventKit store round-trips its IANA time zone; a fixed-offset zone that EventKit reports without an IANA identifier is surfaced as `floating`.
- `recurring: true` means the connector rejects patch, update, complete and delete for that reminder with `unsupported_operation`.

`reminder patch` changes only the fields present in `--input`:

```text
apple-connector reminder patch --list-id <listId> --id <reminderId> \
  [--due <RFC3339> | --due-date <YYYY-MM-DD> | --clear-due] [--time-zone <IANA>] \
  [--completed | --not-completed] \
  --input <file> --idempotency-key <key> --auth-key <key> --json
```

Put private `title` and `body` in the owner-only `--input` file, never on the command line. `due: null` clears the due date; `completed: false` reopens the reminder. `reminder update` remains a full replacement of `title`, `body` and `completed`.

`calendarItemIdentifier` is stable for normal edits within one local EventKit data store. A full sync, account reset, or data-store rebuild can invalidate it; list again to re-resolve an ID instead of treating a missing ID as a deletion.

## Authorizations

An authorization is immutable after creation. One authorization should map to one Agent and can contain Calendar containers and Reminders containers, each with its own actions. Its authorization key is the local profile identifier (the token file name), and the authorization ID is a bearer token shown once on the management page and also written to an owner-only local file.

```text
apple-connector auth show --auth-key <key> --json
apple-connector auth show --auth-file <path> --json
apple-connector auth show --auth <token> --json
apple-connector auth verify --agent <name> --auth-key <key> --json
apple-connector auth verify --agent <name> --auth <token> --json
```

`auth show` returns the authorization name, grants, expiry, last-used time, `agentName` and `verifiedAt`. It never returns the token, token hash or internal record ID.

`auth verify` requires `--agent` (trimmed, 1–100 characters), authenticates the same bearer token, writes `agentName` and `verifiedAt` to the authorization, and appends an `agent_verified` audit event. Re-running it updates the latest binding. The Agent name is self-reported, but the caller must still hold a valid authorization ID. `clients.list` and `auth.describe` also return `agentName` and `verifiedAt`; both are `null` until the first verification.

There is no approval step: a write inside the authorization scope executes immediately. Deleting an authorization invalidates its token, removes its local token file and discards its binding; audit events are retained.

## State migration

`apple-connector migrate-state [--json]` moves the legacy `~/apple-connector` directory to `~/.apple-connector`. It stops the legacy service and management web process first, waits for the service to exit, removes stale runtime files (`service.sock`, pid files, admin URL), and renames the directory. The database, admin token, `profiles/`, authorization token files, audit and logs are preserved.

- `migrated: false` means there was no legacy directory.
- A non-empty destination is never merged; the command returns `conflict` and leaves both directories untouched.
- `APPLE_CONNECTOR_STATE_DIR` must be unset for this command.

## Environment variables

| Variable | Used by | Meaning |
| --- | --- | --- |
| `APPLE_CONNECTOR_STATE_DIR` | CLI, service | Override the state directory (default `~/.apple-connector`). Must be unset for `migrate-state`. |
| `APPLE_CONNECTOR_AUTH` | CLI | Pass an authorization ID directly. Prefer `--auth-file` or `--auth-key` so the token does not appear in shell history or process arguments. |
| `APPLE_CONNECTOR_HELPER_MODE` | CLI, service | Set to `direct` to start the helper as a child process instead of through `AppleConnector.app`. Development, CI and headless troubleshooting only; the permission then follows the host app. |
| `APPLE_CONNECTOR_HELPER_SOCKET` | service (internal) | Socket path injected by the lifecycle into the Node service. Normally do not set it yourself. |
| `APPLE_CONNECTOR_SIGN_IDENTITY` | build only | Override the code-signing identity used by `build:native`. Precedence: this variable → `.signing-identity` → `Apple Connector Local`. |
| `APPLE_CONNECTOR_ALLOW_ADHOC` | build, CI, tests | Set to `1` to allow an ad-hoc signature when the identity is missing. Never publish or install such a build over a normal one. |
| `APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID` | native tests only | Opt in to reminder tests that create and delete UUID probes in the named test list. Unset by default. |
| `NO_COLOR` | CLI | Disable ANSI color, the same as `--no-color`. |
| `APPLE_CONNECTOR_WEB_EXPIRES_AT` | management web (internal) | Expiry timestamp injected when the one-hour management process starts. |

## Documentation

- [Documentation index](README.md) — all guides and the version history.
- [Getting started](getting-started.md) — first-run path.
- [System permissions](system-permissions.md) — the `AppleConnector.app` TCC identity.
- [Signing](signing.md) — self-signed certificate and release build.
- [Upgrade guide](v0.8-to-v0.9-migration.md) — changes across major versions.
