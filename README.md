# Apple Connector

[中文](README_zh.md)

A local Apple data connector for agents, built with TypeScript, Node.js and JXA. The project is in the v0.1.0 capability-validation stage; it is **not ready for distribution** — scoped Reminders/Notes creation is verified, but Calendar writes and existing-object mutation remain gated.

## Development

Node 24.20.0 LTS is the tested release target. Node 26.8.1 is also tested for development. Install dependencies and run the checks:

```sh
npm ci
npm run check
npm run test:native
npm run release:verify
node dist/src/cli/index.js --help
node dist/src/cli/index.js version
node dist/src/cli/index.js doctor
node dist/src/cli/index.js doctor --probe
```

`doctor --probe` requires macOS. It loads EventKit through JXA, inspects authorization status and method availability, and does not request permissions, enumerate personal data, or perform writes. `test:native` additionally checks unsaved in-memory objects and skips on other platforms. Successful probing does not establish full integration support.

## Local service, client pairing and MCP (dev prototype)

The service, client management and MCP entry are implemented and testable without Apple data. Point them at a scratch state directory for evaluation:

```sh
export APPLE_CONNECTOR_STATE_DIR=/tmp/connector-dev   # optional; default is ~/Library/Application Support/AppleConnector
node dist/src/cli/index.js setup                       # state dir, admin session, database
node dist/src/cli/index.js start                       # detached background service (setup already starts it)
node dist/src/cli/index.js open                        # one-time local management link (macOS)
node dist/src/cli/index.js status
node dist/src/cli/index.js client create --name "Agent" \
  --grant '{"provider":"reminders","containerIds":["test-list"],"actions":["create"],"fields":"full","approval":"automatic","expiresAt":1788580000000}'
APPLE_CONNECTOR_TOKEN=<client-token> node dist/src/cli/index.js mcp   # stdio MCP entry
node dist/src/cli/index.js stop
```

Notes:

- `expiresAt` is Unix epoch **milliseconds** (the `Date.now()` scale).
- The admin session token is printed once by `setup`; management commands read it from the state directory on the same machine. Keep it out of agent environments.
- On macOS, `setup` starts the service and opens the one-time local management link. Later browser sessions can be started with `open` after a service restart.
- The service listens on a Unix domain socket inside the 0700 state directory; agent and management RPC methods are separated by credential class.
- The management site binds a random `127.0.0.1` port only. Its one-time bootstrap link is exchanged for an HttpOnly, SameSite session and protected by Host, Origin and CSRF checks. `open` never places the persistent administrator token in a URL.
- Verified native creation is enabled for scoped Reminders lists and non-shared Notes folders through the immutable change-plan flow. Calendar writes and existing-object mutations remain gated; unsupported writes return an explicit error rather than pretending success. MCP exposes `connector.capabilities`, uniquely named Calendar reads (`calendar.list_calendars`/`calendar.list_events`), folder-scoped Notes reads (`notes.list_folders`/`notes.get`/`notes.search`), granted Reminders list/page reads (`reminders.list_lists`/`reminders.list`), `changes.prepare`, `changes.commit` and `operations.get`.

## Scope and evidence

Current code includes the bounded native runner, scoped authorization, SQLite client/audit storage, change-plan state machines, the local service, client pairing, MCP and a loopback-only management UI. Calendar reads are available only when the configured calendar name is unique; Calendar writes, verified native writes and Homebrew distribution are not available yet. A dedicated test container must be explicitly selected before real Apple write tests.

Pending plans may temporarily contain the content needed for execution. Successful, revoked and uncertain operations clear that content. The running service performs maintenance every minute, expires plans after at most 15 minutes, and retains terminal idempotency records for 30 days. Unknown outcomes are not automatically retried or discarded.

Audit defaults are 30 days, 20,000 records and approximately 50 MiB of logical event data. Audit events do not include titles, note bodies or tokens. Runtime logs rotate at 5 MiB, keep at most three files, and expire after seven days; the management interface is still pending. Local records are not tamper-proof, and connector policies do not isolate an agent that independently controls the same macOS user account.

See the [version plan](docs/v0.1.0-plan.md) and [implementation progress](docs/v0.1.0-progress.md) for scope, evidence and outstanding work.
