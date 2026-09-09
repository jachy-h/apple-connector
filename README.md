# Apple Connector

Apple Connector is a local CLI for Apple Calendar and Reminders. It runs only on your Mac: the management page binds to loopback and expires after one hour; there is no LAN, cloud, or MCP endpoint.

## Connect an Agent

Apple Connector works with an Agent running locally on the same Apple Silicon Mac (macOS 14+, supported Node version). It is host-neutral: an Agent only needs to run the CLI and read the packaged [Skill](skill/SKILL.md).

Give your Agent this instruction:

1. Run `uname -m`, `sw_vers -productVersion`, and `node --version` to confirm this Mac is Apple Silicon, macOS 14 or later, and has a supported Node version. Stop and explain if any check fails.
2. Run `npm ls -g --depth=0 @jachy/apple-connector` and confirm that `apple-connector` is linked to the current project through `npm link`. If it is not linked, run `npm install` in the current project.
3. Run `apple-connector skill path --json`, load the returned Skill directory using this Agent's supported mechanism, and report whether that load persists beyond this session.
4. Run `apple-connector agent init --json`, save its `onboardingId`, and say: `Open the [authorization link](URL), then reply “done” here once authorization is complete.` Include the remaining lifetime and replace `URL` with the returned local URL.
5. Wait until I reply “done” after completing the local page.
6. Run `apple-connector agent init-status --id <onboardingId> --json`. If it is configured, use the returned credential-file path only for one bounded, read-only Calendar or Reminders query; otherwise explain the pending or expired state and wait or reinitialize as appropriate.

The Agent returns a temporary local Markdown link. In that page, grant macOS access, select visible Calendar or Reminders containers, choose the profile's actions, and create the profile. Then return to the same Agent and reply “done”. It waits for that reply before checking the setup, then verifies the profile with a bounded read; empty containers are still a successful connection.

For the manual route, recovery and revocation, see [Getting started](docs/getting-started.md), [Agent installation](docs/install-for-agent.md), [Skill reference](docs/skill.md), and the [CLI reference](docs/cli.md).

All machine-facing commands use `--json`; writes require an idempotency key and a profile credential. See the [v0.8 migration guide](docs/v0.8-to-v0.9-migration.md).
