# Apple Connector

[中文](README_zh.md)

A local Apple data connector for agents, built with TypeScript, Node.js and JXA. v0.8.0 provides a local stdio MCP entry, paired-client credentials and a loopback-only management page. It remains a development release and is **not ready for signed distribution**. The local Web page provides Calendar reads and scoped event creation/editing/deletion plus Reminders reads/creation; Apple Notes is temporarily unavailable.

## Development

Node 24.20.0 LTS is the tested release target. Node 26.8.1 is also tested for development. Install dependencies and run the checks:

```sh
npm ci
npm run start
npm run check
npm run test:native
npm run release:verify
node dist/src/cli/index.js --help
node dist/src/cli/index.js version
node dist/src/cli/index.js doctor
node dist/src/cli/index.js doctor --probe
node dist/src/cli/index.js doctor --reminders-m1 <dedicated-list-id>
```

`doctor --probe` requires macOS. It loads EventKit through JXA, inspects authorization status and method availability, and does not request permissions, enumerate personal data, or perform writes. The explicit `--reminders-m1` diagnostic does write only to the supplied dedicated list; it persists a private UUID journal before mutation and supports exact recovery with `doctor --reminders-m1-recover <probe-uuid>`. `test:native` skips unsupported host-specific checks. Successful probing does not establish full integration support.

## Local Web debugging, client pairing and MCP (dev prototype)

The service, client management and MCP entry are implemented and testable without Apple data. Point them at a scratch state directory for evaluation:

```sh
export APPLE_CONNECTOR_STATE_DIR=/tmp/connector-dev   # optional; default is ~/Library/Application Support/AppleConnector
npm run start                                          # rebuilds, replaces any old service, and stays in this terminal
node dist/src/cli/index.js start                       # background mode: start or reuse an existing service
node dist/src/cli/index.js open --print                # prints a newly issued one-time URL without launching a browser
node dist/src/cli/index.js status
node dist/src/cli/index.js client create --name "Agent" --credential-file /absolute/path/apple-connector-agent.token \
  --grant '{"provider":"reminders","containerIds":["test-list"],"actions":["create"],"fields":"full","approval":"automatic","expiresAt":1788580000000}'
node dist/src/cli/index.js mcp config --token-file /absolute/path/apple-connector-agent.token
# Paste the emitted JSON into the agent's stdio-MCP configuration. It starts/reuses the local service.
node dist/src/cli/index.js stop
```

Notes:

- `expiresAt` is Unix epoch **milliseconds** (the `Date.now()` scale).
- Apple Notes is disabled in v0.7.0. New Notes grants are rejected; existing Notes grants and historical metadata remain visible but cannot access Notes.
- The admin session token is printed once by first-time initialization; management commands read it from the state directory on the same machine. Keep it out of agent environments.
- `npm run start` is the recommended development entrypoint. It rebuilds everything, replaces any running instance, and runs the new service in the current terminal; press Ctrl-C to stop it.
- The lower-level `start` command remains idempotent background mode: a second invocation reuses a same-version service and issues a fresh one-time browser link. `open` can likewise reissue a link without restarting or invalidating established sessions.
- The service listens on a Unix domain socket inside the 0700 state directory; agent and management RPC methods are separated by credential class.
- The management site binds a random `127.0.0.1` port only. Its one-time bootstrap link is exchanged for an HttpOnly, SameSite session and protected by Host, Origin and CSRF checks. `open` never places the persistent administrator token in a URL.
- Client access can be created and, for one-grant clients, edited as a form from the management site; credentials can be rotated from the management site or CLI. Policy edits cancel unexecuted plans; rotation invalidates the old token immediately.
- The default management page has only **APPs** and **Audit**. APPs opens Calendar by default, then offers Calendar time-range reads and non-recurring event creation/editing/deletion plus Reminders list reads/unstable creation directly through the authenticated local session. Web writes use a browser-generated operation UUID for idempotency and status recovery; uncertain outcomes are never auto-retried.
- Audit shows only Web-debug records, with App/result/time filtering and pagination. It does not retain titles, bodies, tokens or raw native errors. The management service also runs only a fixed, explicitly targeted Reminders M1 diagnostic with a durable UUID journal and exact-cleanup recovery; it never accepts arbitrary shell or JXA input.
- Verified native creation is enabled for scoped Reminders lists through the immutable change-plan flow. Calendar changes are limited to the authenticated management page; MCP exposes uniquely named Calendar reads (`calendar.list_calendars`/`calendar.list_events`), granted Reminders list/page reads (`reminders.list_lists`/`reminders.list`), `changes.prepare`, `changes.commit` and `operations.get`. The stdio entry starts or reuses the user-local service, has a 60-second RPC timeout for native writes, and emits protocol messages only on stdout. `mcp config` keeps the client token in a 0600 file rather than command arguments or generated configuration. Notes tools are not registered.

## Scope and evidence

Current code includes the bounded native runner, scoped authorization, SQLite client/audit storage, change-plan state machines, the local service, client pairing, MCP and a loopback-only management UI. Calendar reads require a uniquely named configured calendar; non-recurring event writes are verified and available only in the authenticated management UI. Homebrew distribution is not available yet. A dedicated test container must be explicitly selected before real Apple write tests.

Pending plans may temporarily contain the content needed for execution. Successful, revoked and uncertain operations clear that content. The running service performs maintenance every minute, expires plans after at most 15 minutes, and retains terminal idempotency records for 30 days. Unknown outcomes are not automatically retried or discarded.

Audit defaults are 30 days, 20,000 records and approximately 50 MiB of logical event data. Audit events do not include titles, note bodies or tokens. Runtime logs rotate at 5 MiB, keep at most three files, and expire after seven days. The management interface exposes metadata-only runtime, operation and SQLite diagnostics. Local records are not tamper-proof, and connector policies do not isolate an agent that independently controls the same macOS user account.

See the [v0.8.0 plan](docs/v0.8.0-plan.md), [implementation progress](docs/v0.8.0-progress.md), and [v0.2.0 support matrix](docs/v0.2.0-support-matrix.md) for scope, evidence and outstanding work.
