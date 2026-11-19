# Signing Apple Connector without an Apple Developer account

[中文](signing_zh.md) · English

Apple Connector does not need Apple Developer Program membership, notarization, or a
Developer ID to keep macOS Calendar and Reminders permission across upgrades. It needs a
**stable code-signing identity**: a self-signed certificate created once on the machine that
builds the release.

This document explains why, how to create the certificate, how the build uses it, and how to
verify and rotate it.

## Why a self-signed certificate is enough

macOS TCC stores permission against the app's **designated requirement**:

- An **ad-hoc** signature produces `cdhash H"…"`. Every rebuild changes the hash, so macOS
  treats the new binary as a different app and the Calendar/Reminders grant is lost.
- A **certificate** signature produces
  `identifier "com.jachy.apple-connector" and certificate leaf = H"…"`. The requirement stays
  the same across rebuilds and upgrades as long as the bundle id and certificate do not change.

The certificate does not need to be issued by Apple. It only needs to stay the same.

The App bundle is `dist/native/AppleConnector.app` with bundle id
`com.jachy.apple-connector`. Its main executable is the native helper, which opens a
user-only Unix socket for the Node service. macOS therefore records Calendar/Reminders access
for **Apple Connector**, not for Terminal, OpenCode, or another host app.

## Create the signing identity once

Use Keychain Access. The default identity name is `Apple Connector Local`; you can choose a
different name and set `APPLE_CONNECTOR_SIGN_IDENTITY` when building.

1. Open **Keychain Access**.
2. Menu **Keychain Access → Certificate Assistant → Create a Certificate…**
3. Set:
   - **Name:** `Apple Connector Local`
   - **Identity Type:** Self Signed Root
   - **Certificate Type:** Code Signing
   - **Validity Period:** 3650 days (or longer; keep it longer than you plan to use the app)
4. Create the certificate.
5. Optional: open the certificate → **Get Info → Trust**, set **When using this certificate**
   to **Always Trust** for code signing on this Mac. This only affects this Mac; users who
   install your npm package do not need the certificate or this trust setting.

Verify that macOS can see the identity:

```bash
npm run signing:check
# or
security find-identity -p codesigning | grep "Apple Connector Local"
```

`security find-identity -v` only lists identities whose trust chain passes; an untrusted
self-signed certificate may be omitted. Use `-p codesigning` without `-v` to check whether
the identity exists, and use `codesign` to test signing.

## Build and sign

```bash
npm run build          # management UI + TypeScript + native App
npm run build:native   # only rebuild and sign the App and standalone helper
```

The build script:

1. runs `swift build -c release`;
2. copies the helper to `dist/native/apple-connector-helper`;
3. assembles `dist/native/AppleConnector.app` with `Info.plist`;
4. signs both the standalone helper and the App with the identity;
5. verifies the App and prints its designated requirement.

To use a different identity:

```bash
APPLE_CONNECTOR_SIGN_IDENTITY="My Company Local Signing" npm run build:native
```

To avoid exporting the variable on every command, create `.signing-identity` at the repository root containing the identity name (for example `JachyCertificate`). It is git-ignored. Precedence: `APPLE_CONNECTOR_SIGN_IDENTITY` → `.signing-identity` → `Apple Connector Local`.

If the identity is missing, the build **fails** instead of silently producing an ad-hoc build.
For CI or a throwaway test build only:

```bash
APPLE_CONNECTOR_ALLOW_ADHOC=1 npm run build:native
```

That build prints a warning. Do not publish it and do not install it over a working setup:
macOS will forget the permission the next time the App changes.

## Verify the signature

```bash
codesign --verify --strict --verbose=2 dist/native/AppleConnector.app
codesign -dv --verbose=4 dist/native/AppleConnector.app 2>&1
codesign -d -r- dist/native/AppleConnector.app 2>&1
```

Expected values:

- `Identifier=com.jachy.apple-connector`
- `Authority=Apple Connector Local` (or your chosen identity)
- no `Signature=adhoc`
- designated requirement contains `certificate leaf = H"…"` and **does not** contain `cdhash`

You can also run `npm run release:verify`. It checks the App bundle, bundle id, usage
descriptions, version, and (unless `APPLE_CONNECTOR_ALLOW_ADHOC=1`) the signature identity and
requirement.

## What survives an upgrade

With the same certificate and bundle id:

- rebuilding the helper;
- upgrading the npm package;
- changing the installation path (for example, a different Node version manager prefix);
- restarting the service

do **not** remove the Calendar or Reminders grant.

Changing the certificate, changing the bundle id, or signing ad-hoc **does** create a new
identity. The old grant remains attached to the old identity but the new App must ask again.
After re-signing, stop and start the service before testing: a running helper is reused when
its version matches, even if the App on disk has a new signature.

## Verify the running helper

```bash
apple-connector status          # helper running, pid, socket
apple-connector doctor          # helper permissions read from the App
codesign -dv --verbose=4 dist/native/AppleConnector.app 2>&1 | grep -E 'Identifier|Authority|Signature'
```

`status` reports the helper as running only when both `<state dir>/helper.pid` and
`<state dir>/helper.sock` exist. `doctor` reads `permissions.status` over that socket. If
`doctor` shows `not_determined` after you granted access, confirm the App launching is the
one you just signed; a stale App in another path can still own the socket.

## Distribution boundaries

- The npm tarball contains the signed App. Users do **not** need your certificate, its private
  key, or a trust setting to run it. TCC validates the certificate hash embedded in the
  signature.
- People who build from source create their own certificate; each Mac has its own identity and
  its own grant. That is expected.
- CI builds (`APPLE_CONNECTOR_ALLOW_ADHOC=1`) are for tests only. Never publish a CI artifact.
- Without notarization, a **quarantined** copy (for example, a tarball downloaded through a
  browser) can still be blocked by Gatekeeper on first launch. npm and local source installs
  normally do not carry the quarantine attribute. If macOS blocks the App, allow it in
  **System Settings → Privacy & Security → Open Anyway**, or remove the attribute from a copy
  you trust:

  ```bash
  xattr -dr com.apple.quarantine /path/to/AppleConnector.app
  ```

  This project still does not ship a public `.app`, DMG or Homebrew Cask.

## Private key and rotation

The **private key** is the sensitive part. Anyone who has it can sign an App that inherits the
permissions users granted to Apple Connector. Keep it:

- only on the release machine and in a password manager / offline backup;
- out of the repository, CI variables, logs and screenshots;
- protected by the login keychain and a strong account password.

If the key is lost or the certificate expires, create a new identity and rebuild. Every user
must grant Calendar/Reminders once more. Do not rotate the identity for routine releases.
Write down the identity name and expiry date in the release checklist.

The build may ask for keychain access the first time. Choose **Always Allow** for `codesign` so
unattended rebuilds do not prompt again.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Code-signing identity "Apple Connector Local" was not found` | Certificate missing, renamed, or in a locked keychain | Create it again or set `APPLE_CONNECTOR_SIGN_IDENTITY`; unlock the login keychain |
| `security find-identity -v` shows 0 identities | Self-signed certificate is not trusted | Use `-p codesigning` without `-v`; optional: set Trust → Code Signing → Always Trust |
| Build asks for keychain password every time | `codesign` has no permanent key access | In the keychain prompt choose **Always Allow**, or manage the key's access control |
| `codesign --verify` fails | The App bundle was edited after signing | Re-run `npm run build:native`; never edit `Contents/` by hand |
| Permission resets after every build | The build fell back to ad-hoc, or the identity changed | Check the build output; run the `codesign -d -r-` check above |
| Gatekeeper refuses to open the App | Quarantine on a downloaded copy | Allow it in System Settings, or remove the quarantine attribute from a trusted copy |
| App launches but no socket appears | Gatekeeper/keychain blocked the launch, or the App was not built | Check `~/.apple-connector/helper.log`; run `apple-connector doctor`; rebuild |

See [system-permissions.md](./system-permissions.md) for the permission flow itself,
[documentation index](README.md) for all guides, and [native-validation.md](./native-validation.md)
for the verification records.
