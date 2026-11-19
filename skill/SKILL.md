---
name: apple-connector
description: Use the local Apple Connector CLI for user-authorized Apple Calendar and Reminders. Use whenever the user asks to schedule, remind, list, create, update, patch, complete, or delete Calendar events or reminders on this Mac.
---

# Apple Connector

Use only the public `apple-connector` CLI. Never call its helper, socket, database, management Web API, or read/display authorization IDs beyond what the user hands over. Every machine call must use `--json`.

## Authorization key and ID

The default prompt gives an authorization key (a local profile UUID, not a secret). Pass it with `--auth-key <key>`; apple-connector resolves the owner-only credential itself. Do not read, copy, scan or print token files in the profile directory, and do not derive a file path from the key.

The prompt may instead contain an authorization ID (bearer token) as a fallback only when the key cannot be used. Store it in the host Agent’s secret store (or an owner-only file), never in chat or logs. Pass it with `APPLE_CONNECTOR_AUTH` or `--auth-file <path>`; `--auth <token>` also works but leaks through shell history. An older prompt may contain an explicit `Credential file` path; pass it with `--auth-file <path>` and never read or print its contents.

An authorization is immutable after creation: to change Calendar/Reminders containers or actions, the user deletes it and creates a new one. A deleted authorization ID stops working immediately.

## Intent

Use Calendar for events with a start and end. Use Reminders for tasks, due dates, completion, and reminder requests.

When the user asks to be reminded, or expresses equivalent intent, you must synchronize Apple Reminders in the same task: create a new reminder for a new request; patch, update, complete, or delete only when the user clearly identifies an existing reminder. Never merely promise to remind the user. If the intended action, target, requested due time, or time zone is unclear, ask first; an omitted due date may remain unset.

## Connect

When no usable authorization is retained, ask the user to run `apple-connector init` on this Mac, complete the local setup page (system access, then one authorization for this Agent), and paste the generated Agent prompt here. The human must grant macOS permission and create the authorization; do not create it on their behalf.

The prompt may contain:

- an `Authorization key` / `授权 key`: preferred. Pass it with `--auth-key <key>`. The CLI resolves the local credential; never read, scan or print the profile directory, and never derive a file path from the key; and/or
- an authorization ID with a storage warning: use it only when the authorization key cannot be used. Store it immediately in the host Agent’s secret store or an owner-only mode `0600` file, and inject it through `APPLE_CONNECTOR_AUTH` or `--auth-file <path>`. Never echo it, and never put it in chat, logs, repositories or shell history; and/or
- an explicit `Credential file` / `凭据文件` path from an older prompt: pass it with `--auth-file <path>` and never read or print its contents.

After receiving a prompt:

1. Run `apple-connector skill path --json` and load the packaged Skill if it is not already available.
2. Run `apple-connector auth verify --agent '<your name>' --auth-key <key> --json` (or `--auth <token>` / `--auth-file <path>` when the prompt provides those instead). Replace `<your name>` with your product or client name. This writes the binding and makes the setup page show “Agent bound” immediately.
3. Validate with one bounded read-only query: `calendar list-calendars` or `reminder list-lists`, according to the returned grants.

To inspect the authorization name, scope and expiry, run `apple-connector auth show --auth-key <key> --json` (or the equivalent with the stored authorization ID).

For the full usage guide, run `apple-connector open --section docs --json` and give the returned Markdown link to the user. You may also read `docs/cli.md` and `apple-connector help`.

If the prompt is missing, incomplete or expired, ask the user to run `apple-connector init` again and paste the new prompt. Do not guess a credential path, scan the state or profile directory for tokens, or call business commands before authorization is verified.

For macOS permissions, authorization scope, or audit, respectively run `apple-connector open --section <setup|audit> --json`, return its Markdown link, and let the user operate the page. `permissions` and `agents` remain accepted aliases for `setup`. There is no approval step: a write in scope executes immediately.

Since v0.17.0 the system permission belongs to the Apple Connector App. If the setup page reports `not_determined`, `denied`, or `restricted`, ask the user to grant Calendar/Reminders there or in System Settings; do not request Full Disk Access. `permission_denied` can mean either a missing system permission or an authorization that is too narrow, so check the setup page first. For a terminal diagnosis, `apple-connector status` shows whether the helper App runs and `apple-connector doctor` reads its permissions; the `doctor --probe` JXA result reflects the launching host, not the App.

## Read and select

```text
apple-connector calendar list-calendars --auth-key <key> --json
apple-connector calendar list --calendar-id <calendarId> --from <RFC3339> --to <RFC3339> [--offset N] [--limit 1..100] --auth-key <key> --json
apple-connector reminder list-lists --auth-key <key> --json
apple-connector reminder list --list-id <listId> [--offset N] [--limit 1..100] --auth-key <key> --json
```

Follow `nextOffset` until it is `null` when the target may be on another page. Before patch, update, complete, or delete, list first. A title may locate candidates, but never mutate by title: use the returned container ID and object ID. Stop for no match, multiple matches, missing IDs, or other ambiguity.

Each reminder list item contains `due` and `recurring`. `due` is `null` or one of:

- `{"kind":"date","date":"YYYY-MM-DD"}` for an all-day due.
- `{"kind":"floating","date":"YYYY-MM-DD","time":"HH:mm:ss"}` for a wall-clock due with no time zone.
- `{"kind":"instant","at":"RFC3339-with-offset","timeZone":"IANA"}` for a zoned due.

`recurring: true` means the connector cannot patch, update, complete, or delete that reminder; show it as read-only instead of guessing. EventKit IDs are stable for normal edits in the same local data store, but a full sync, account reset, or data-store rebuild can invalidate them. If an ID is no longer found, list again to re-resolve it; do not treat that as proof the user deleted it.

Convert natural-language instants to RFC 3339 with an explicit offset. Require `to > from` and `end > start`.

## Write

Use one stable `--idempotency-key` for each logical write. Put private `title`, `body`, `location`, and `notes` in a temporary JSON object file with mode `0600`, pass it through `--input`, retain it through recovery, then delete it after a terminal result.

```text
apple-connector calendar create --calendar-id <calendarId> --start <RFC3339> --end <RFC3339> [--all-day] --input <file> --idempotency-key <key> --auth-key <key> --json
apple-connector calendar update --calendar-id <calendarId> --id <eventId> --start <RFC3339> --end <RFC3339> [--all-day] --input <file> --idempotency-key <key> --auth-key <key> --json
apple-connector calendar delete --calendar-id <calendarId> --id <eventId> --idempotency-key <key> --auth-key <key> --json
apple-connector reminder create --list-id <listId> [--due <RFC3339>] [--due-date <YYYY-MM-DD>] [--time-zone <IANA>] --input <file> --idempotency-key <key> --auth-key <key> --json
apple-connector reminder patch --list-id <listId> --id <reminderId> [--due <RFC3339> | --due-date <YYYY-MM-DD> | --clear-due] [--time-zone <IANA>] [--completed | --not-completed] --input <file> --idempotency-key <key> --auth-key <key> --json
apple-connector reminder update --list-id <listId> --id <reminderId> [--completed] --input <file> --idempotency-key <key> --auth-key <key> --json
apple-connector reminder complete --list-id <listId> --id <reminderId> --idempotency-key <key> --auth-key <key> --json
apple-connector reminder delete --list-id <listId> --id <reminderId> --idempotency-key <key> --auth-key <key> --json
```

Calendar input contains `title`, `location`, and `notes`. Reminder create input contains `title`, optional `body`, and optional `due`; update input contains `title` and `body`. Reminder due is exactly one of:

- date-only: `{"kind":"date","date":"YYYY-MM-DD"}`; date-only due must not include `timeZone`.
- floating: `{"kind":"floating","date":"YYYY-MM-DD","time":"HH:mm[:ss]"}`; floating due must not include `timeZone`.
- instant: `{"kind":"instant","at":"RFC3339-with-offset","timeZone":"IANA"}`.

Reminder create and patch also accept due directly as flags (no `--input` needed): `--due <RFC3339>` for a timed reminder (timezone inferred from the offset, e.g. `+08:00` → `Asia/Shanghai`, overridable with `--time-zone <IANA>`) or `--due-date <YYYY-MM-DD>` for an all-day reminder. `--due` and `--due-date` are mutually exclusive. `reminder patch` additionally accepts `--clear-due`.

Use `reminder patch` for an edit: put only the fields to change in `--input` (`title`, `body`, `due`, `completed`); omitted fields stay unchanged. Put `title` and `body` only in `--input`, never on the command line. `due: null` clears the due date; `completed: false` reopens a completed reminder. Use `reminder update` only when a full replacement is explicitly intended: it requires `title`, `body`, and `completed`, and you must read the object first and preserve every unchanged field, including false/empty values. If any required field is unavailable or redacted, stop. Recurring items cannot be patched, updated, completed, or deleted.

## Write states

Do not report success unless the state is `succeeded`.

- `outcome_unknown`: never change the key or payload. If no operation ID was returned, resubmit the exact same write once with the same payload and idempotency key to retrieve its durable record; then use `apple-connector operation get --id <operationId> --auth-key <key> --json` with the same authorization. For `reminder patch`, you may also list the reminder and compare the requested fields to reconcile; do not issue a new logical write.
- `failed`, `expired`, or `cancelled`: report that no success was confirmed and stop.

Stop on permission denial, ambiguity, conflict, or `unsupported_operation`; never weaken an authorization or bypass its scope.
