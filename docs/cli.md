# CLI reference

`apple-connector` is the sole public integration entry point in v0.9.5. All machine-facing commands accept `--json` and write one versioned JSON envelope to stdout.

Run `apple-connector --help` for commands. Use `--profile` or `--credential-file` for agent calls; writes require `--idempotency-key`. Put sensitive content in an owner-only `--input` JSON file.

`apple-connector skill path --json` returns the absolute packaged Skill directory and package version. `apple-connector agent init --json` creates a new, opaque onboarding ID and returns `{ onboardingId, url, expiresAt, remainingSeconds, section }`. The URL is loopback-only and expires with the management session.

After the user completes the local page, call `apple-connector agent init-status --id <onboardingId> --json`. Its state is `pending`, `configured`, or `expired` (and may be `failed`). A configured result includes the profile name, grant summary and absolute `credentialFile`, but never its token. Do not inspect the credential file; pass its path only as `--credential-file` for the subsequent bounded read.
