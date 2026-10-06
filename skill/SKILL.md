---
name: apple-connector
description: Use the local Apple Connector CLI for user-authorized Apple Calendar and Reminders. Use whenever the user asks to schedule, remind, list, create, update, complete, or delete Calendar events or reminders on this Mac.
---

# Apple Connector

Use only the public `apple-connector` CLI. Never call its helper, socket, database, management Web API, or read/display credential or token contents. Every machine call must use `--json`.

## Intent

Use Calendar for events with a start and end. Use Reminders for tasks, due dates, completion, and reminder requests.

When the user asks to be reminded, or expresses equivalent intent, you must synchronize Apple Reminders in the same task: create a new reminder for a new request; update, complete, or delete only when the user clearly identifies an existing reminder. Never merely promise to remind the user. If the intended action, target, requested due time, or time zone is unclear, ask first; an omitted due date may remain unset.

## Connect

When no usable credential is retained, run `apple-connector agent init --json` and retain its `onboardingId`. Return the URL as a Markdown link, include the remaining expiry, and match the user's language:

- Chinese, exactly: `请打开[授权链接](URL)，完成授权后在此回复「已完成」。`
- English: `Open the [authorization link](URL), then reply “done” here once authorization is complete.`

Wait for the user's reply. Before it, do not open the page, poll status, or make business calls. Then run `apple-connector agent init-status --id <onboardingId> --json`:

- `pending`: keep waiting.
- `expired`: initialize again and return the new link.
- `failed`: report the returned non-secret failure and stop.
- `configured`: retain `credentialFile` without reading it; validate with `calendar list-calendars` or `reminder list-lists` according to the returned grants.

Pass that path to every business command and `operation get` with `--credential-file <path>`.

For macOS permissions, profile grants/revocation, approvals, or audit, respectively run `apple-connector open --section <permissions|agents|approvals|audit> --json`, return its Markdown link, and let the user operate the page.

## Read and select

```text
apple-connector calendar list-calendars --credential-file <path> --json
apple-connector calendar list --calendar-id <calendarId> --from <RFC3339> --to <RFC3339> [--offset N] [--limit 1..100] --credential-file <path> --json
apple-connector reminder list-lists --credential-file <path> --json
apple-connector reminder list --list-id <listId> [--offset N] [--limit 1..100] --credential-file <path> --json
```

Follow `nextOffset` until it is `null` when the target may be on another page. Before update, complete, or delete, list first. A title may locate candidates, but never mutate by title: use the returned container ID and object ID. Stop for no match, multiple matches, missing IDs, or other ambiguity.

Convert natural-language instants to RFC 3339 with an explicit offset. Require `to > from` and `end > start`.

## Write

Use one stable `--idempotency-key` for each logical write. Put private `title`, `body`, `location`, and `notes` in a temporary JSON object file with mode `0600`, pass it through `--input`, retain it through approval/recovery, then delete it after a terminal result.

```text
apple-connector calendar create --calendar-id <calendarId> --start <RFC3339> --end <RFC3339> [--all-day] --input <file> --idempotency-key <key> --credential-file <path> --json
apple-connector calendar update --calendar-id <calendarId> --id <eventId> --start <RFC3339> --end <RFC3339> [--all-day] --input <file> --idempotency-key <key> --credential-file <path> --json
apple-connector calendar delete --calendar-id <calendarId> --id <eventId> --idempotency-key <key> --credential-file <path> --json
apple-connector reminder create --list-id <listId> [--due <RFC3339>] [--due-date <YYYY-MM-DD>] [--time-zone <IANA>] --input <file> --idempotency-key <key> --credential-file <path> --json
apple-connector reminder update --list-id <listId> --id <reminderId> [--completed] --input <file> --idempotency-key <key> --credential-file <path> --json
apple-connector reminder complete --list-id <listId> --id <reminderId> --idempotency-key <key> --credential-file <path> --json
apple-connector reminder delete --list-id <listId> --id <reminderId> --idempotency-key <key> --credential-file <path> --json
```

Calendar input contains `title`, `location`, and `notes`. Reminder create input contains `title`, optional `body`, and optional `due`; update input contains `title` and `body`. Reminder due is exactly one of:

- date-only: `{"kind":"date","date":"YYYY-MM-DD"}`; date-only due must not include `timeZone`.
- instant: `{"kind":"instant","at":"RFC3339-with-offset","timeZone":"IANA"}`.

Reminder create also accepts due directly as flags (no `--input` needed): `--due <RFC3339>` for a timed reminder (timezone inferred from the offset, e.g. `+08:00` → `Asia/Shanghai`, overridable with `--time-zone <IANA>`) or `--due-date <YYYY-MM-DD>` for an all-day reminder. `--due` and `--due-date` are mutually exclusive.

The fields accepted by Calendar and Reminder updates are full replacements. Read the object first and preserve every unchanged field, including false/empty values; change only what the user requested. If any required field is unavailable or redacted, stop. Reminder update cannot change `due`; use `--completed` when preserving or setting `completed: true`. Recurring items cannot be updated or deleted, and recurring reminders cannot be completed.

## Write states

Do not report success unless the state is `succeeded`.

- `prepared`: retain the operation ID, input, and key; open the approvals page and wait. After the user confirms approval, query `apple-connector operation get --id <operationId> --credential-file <path> --json`. If `approved`, resubmit the exact same write with the same payload and idempotency key.
- `outcome_unknown`: never change the key or payload. If no operation ID was returned, resubmit the exact same write once with the same payload and idempotency key to retrieve its durable record; then use `operation get` with the credential path. Do not issue a new logical write.
- `failed`, `expired`, or `cancelled`: report that no success was confirmed and stop.

Stop on permission denial, ambiguity, conflict, or `approval_required`; never weaken grants or bypass approval.
