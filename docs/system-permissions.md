# macOS permissions and the Apple Connector App

[中文](system-permissions_zh.md) · English

Apple Connector reads Calendar and Reminders through EventKit. macOS protects both with TCC
(Transparency, Consent, and Control). The permission is not attached to a command, a script,
or a helper process: it is attached to the **responsible app identity**.

Since v0.17.0, Apple Connector runs its EventKit helper as
`AppleConnector.app` (bundle id `com.jachy.apple-connector`). macOS therefore lists
**Apple Connector** in System Settings and the permission survives upgrades that keep the same
signing identity. See [signing.md](./signing.md) for the certificate setup.

## What changed from older versions

In v0.16.x and earlier the helper was a plain child process of the Node service. TCC attributed
it to the app that launched the service — Terminal, iTerm2, OpenCode, or another agent host.
That had two consequences:

- System Settings showed the host app, not Apple Connector.
- Starting the service from a different host, or granting/revoking the permission for that
  host, silently changed what Apple Connector could read.

Rebuilding the helper did **not** change the permission in that architecture; the host app
owned it. From v0.17.0, the App owns it instead.

## First-time grant

1. Run `apple-connector init` (or `apple-connector open`).
2. On the setup page, step 1, select **Request Calendar access** and/or
   **Request Reminders access**.
3. macOS shows a prompt naming **Apple Connector**. Choose **Allow Full Access**.
4. The page refreshes the status from the App. Repeat for the other provider if needed.

You can also check System Settings → **Privacy & Security → Calendars** or **Reminders**.
**Apple Connector** should appear there with full access. If you previously granted Calendar or
Reminders to Terminal/OpenCode, those older entries remain but are no longer used by v0.17.0;
you can turn them off.

The App requests only the provider you click. It does not request Full Disk Access, Automation,
or Screen Recording for Calendar/Reminders.

## Check the current state

- **Management page → setup → step 1**: the authoritative status, read from the helper App.
- `apple-connector status`: shows the service and whether the helper App is running.
- `apple-connector doctor`: shows helper permissions read over the helper socket. The separate
  **JXA probe** (`--probe`) runs through `osascript` and reflects the process that launched the
  CLI, not the Apple Connector App; do not use it to judge the App's permission.

Status values:

| Status | Meaning |
| --- | --- |
| `full_access` | The App can read and write the provider. |
| `write_only` | Only write access; reads such as `list-calendars` will fail. Request full access. |
| `not_determined` | The App has never been granted this provider, or it is a new signing identity. Request access. |
| `denied` | The user turned the App off in System Settings (or declined the prompt). |
| `restricted` | Blocked by MDM, parental controls, or system policy. |
| `unknown` | The helper could not report a status; check `helper.log` and `doctor`. |

## `permission_denied` is not always a system permission

The CLI uses `permission_denied` for two different failures:

1. **System permission missing** — the helper's EventKit status is not `full_access`.
2. **Authorization scope too narrow** — the authorization does not cover that container, action
   or time range, or it has expired.

Troubleshooting order:

1. Check the setup page's system permission card (or `apple-connector doctor`).
2. If it is not `full_access`, fix the system permission first.
3. If it is `full_access`, open the authorization and check container, actions and expiry.
4. Only then inspect the audit event's exact error.

## Upgrades, reinstall and migration

- **Same certificate, same bundle id**: the grant survives rebuilding, upgrading and moving the
  installation path. No action needed.
- **v0.16.x → v0.17.0**: the App is a new identity, so Calendar/Reminders start as
  `not_determined`. Grant once on the setup page. The old host-app grants remain but are not
  inherited.
- **New certificate or bundle id**: grant once more. This includes certificate rotation.
- **Ad-hoc build**: macOS forgets the grant whenever the App changes. Rebuilds require
  re-granting every time. Use it only for CI or throwaway tests.

Existing state (`~/.apple-connector`), authorizations, tokens and audit records are not affected.

## Headless or SSH sessions

TCC prompts require a local GUI session. If the service is started from SSH or another
non-GUI context, the prompt may not appear and the status can stay `not_determined`.

For development or diagnostics only, the service can start the helper directly:

```bash
APPLE_CONNECTOR_HELPER_MODE=direct apple-connector start
```

In this mode the helper is a child of the CLI, so the permission follows the host app again.
Do not use it for normal use. Stop it and start normally afterwards.

## Resetting permission

Avoid `tccutil reset Calendar` / `tccutil reset Reminders` unless you are prepared to grant
access to every app again. To revoke only Apple Connector, use System Settings and turn off the
Apple Connector entry. The next request will prompt again.

## If the App does not appear in System Settings

1. `apple-connector status` must show the helper as running.
2. `apple-connector doctor` should show helper permissions; if the helper is stopped, start the
   service first.
3. Check `~/.apple-connector/helper.log` for launch failures.
4. Re-run `npm run build:native` and confirm the build was **not** ad-hoc, or reinstall the npm
   package.
5. If macOS blocked the App, allow it in System Settings → Privacy & Security, then start again.

Rebuilding the helper without a stable identity is the most common reason a permission appears
to “disappear by itself”. Verify the signature with the commands in
[signing.md](./signing.md#verify-the-signature).

## Related

- [Signing](signing.md) — create and verify the self-signed identity.
- [CLI reference](cli.md) — `status`, `doctor` and the helper socket.
- [Documentation index](README.md) — all guides and version history.
