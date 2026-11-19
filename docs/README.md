# Apple Connector documentation

[中文](README_zh.md) · English

This directory is organised into four parts: guides for the person using the Mac,
references for Agents and automation, macOS integration notes, and the version history.

Current version: **0.17.0**. See the [changelog](#version-history) for the plan and
progress record of every release.

## Start here

| Document | Audience | What it covers |
| --- | --- | --- |
| [Getting started](getting-started.md) · [中文](getting-started_zh.md) | People | Install, `init`, system access, one Agent authorization, verification |
| [Agent installation](install-for-agent.md) · [中文](install-for-agent_zh.md) | Agents | Prerequisites, packaged Skill, binding an authorization, first read |
| [CLI reference](cli.md) · [中文](cli_zh.md) | People and Agents | Commands, JSON envelope, authorization inputs, environment variables |
| [Skill reference](skill.md) · [中文](skill_zh.md) | Agents | How the packaged Skill is imported and used |
| [System permissions](system-permissions.md) · [中文](system-permissions_zh.md) | People | TCC, the `AppleConnector.app` identity, status values, troubleshooting |
| [Signing](signing.md) · [中文](signing_zh.md) | People who build from source | Self-signed certificate, signed build, verification, rotation |
| [Distribution decision](distribution-decision.md) | Maintainers | Why public `.app` / Homebrew distribution is deferred |
| [Upgrade guide](v0.8-to-v0.9-migration.md) | People upgrading | Removed MCP entry, legacy state directory, v0.17 permission owner |
| [Native validation](native-validation.md) | Maintainers | EventKit, helper and TCC verification records |

## Common paths

**First install from source**

```bash
npm run signing:check        # create the identity once if it is missing (docs/signing.md)
npm ci && npm run build
npm link
apple-connector version
apple-connector init
```

**Daily use**

```bash
apple-connector status       # service + helper state
apple-connector open         # setup, audit, docs
apple-connector doctor       # version, platform, helper permissions
```

**Troubleshooting order**

1. `apple-connector status` — is the service running, and is the helper App running?
2. `apple-connector doctor` — do the helper permissions read `full_access`?
3. Setup page step 1 — the authoritative system-permission status.
4. Authorization scope and expiry — containers, actions and time range.
5. `outcome_unknown` — check `operation get`; never retry with a new idempotency key.

See [System permissions](system-permissions.md) for the full permission flow.

## macOS integration

Since v0.17.0, Calendar and Reminders permission belongs to the self-signed
`AppleConnector.app` (bundle id `com.jachy.apple-connector`), not to Terminal, OpenCode or
another agent host. The Node service talks to the helper over `<state dir>/helper.sock`.
The grant survives rebuilds and upgrades as long as the bundle id and signing certificate
do not change. Read [System permissions](system-permissions.md) first, then
[Signing](signing.md) if you build from source.

## Version history

Each release has a plan and a progress record. The history is written in Chinese; the Theme
column is included so that readers can find a change quickly. These records live in the
repository and are not included in the npm tarball; use the GitHub repository to open them.

| Version | Theme | Records |
| --- | --- | --- |
| 0.1.x | Prototype baseline | [0.1.0 plan](v0.1.0-plan.md) · [progress](v0.1.0-progress.md) · [0.1.1 plan](v0.1.1-plan.md) · [progress](v0.1.1-progress.md) |
| 0.2.0 | Native validation and support matrix | [plan](v0.2.0-plan.md) · [progress](v0.2.0-progress.md) · [matrix](v0.2.0-support-matrix.md) |
| 0.3.0 | Reliable local service | [plan](v0.3.0-plan.md) · [progress](v0.3.0-progress.md) |
| 0.4.0 | Web debugging MVP | [plan](v0.4.0-plan.md) · [progress](v0.4.0-progress.md) |
| 0.5.0 | TypeScript + persistent Swift helper | [plan](v0.5.0-plan.md) · [progress](v0.5.0-progress.md) |
| 0.6.x | Reminder and calendar web management | [0.6.0](v0.6.0-plan.md) · [0.6.1](v0.6.1-plan.md) · [0.6.2](v0.6.2-plan.md) · [0.6.3](v0.6.3-plan.md) · [0.6.4](v0.6.4-plan.md) · [0.6.5](v0.6.5-plan.md) |
| 0.7.0 | Temporarily hide Notes | [plan](v0.7.0-plan.md) · [progress](v0.7.0-progress.md) |
| 0.8.x | stdio MCP, npm publish, Agent-first README | [0.8.0](v0.8.0-plan.md) · [0.8.1](v0.8.1-plan.md) · [0.8.2](v0.8.2-plan.md) · [0.8.3](v0.8.3-plan.md) · [0.8.4](v0.8.4-plan.md) |
| 0.9.x | Skill + CLI entry point, management web, memory fix | [0.9.0](v0.9.0-plan.md) · [0.9.1](v0.9.1-plan.md) · [0.9.2](v0.9.2-plan.md) · [0.9.3](v0.9.3-plan.md) · [0.9.4](v0.9.4-plan.md) · [0.9.5](v0.9.5-plan.md) · [0.9.6](v0.9.6-plan.md) · [0.9.7](v0.9.7-plan.md) |
| 0.10.0 | Reminder patch, structured due, recurrence flag | [plan](v0.10.0-plan.md) · [progress](v0.10.0-progress.md) |
| 0.11.0 | Per-container grants and revocation | [plan](v0.11.0-plan.md) · [progress](v0.11.0-progress.md) |
| 0.12.0 | Permission guidance and usage docs | [plan](v0.12.0-plan.md) · [progress](v0.12.0-progress.md) |
| 0.13.0 | `help` / `version`, terminal colors | [plan](v0.13.0-plan.md) · [progress](v0.13.0-progress.md) |
| 0.14.x | Immutable authorizations, one-time tokens, state directory | [0.14.0](v0.14.0-plan.md) · [0.14.1](v0.14.1-plan.md) |
| 0.15.x | Simplified onboarding, calendar field cleanup | [0.15.0](v0.15.0-plan.md) · [0.15.1](v0.15.1-plan.md) |
| 0.16.x | Merged setup page, Agent binding, audit heatmap | [0.16.0](v0.16.0-plan.md) · [0.16.1](v0.16.1-plan.md) · [0.16.2](v0.16.2-plan.md) · [0.16.3](v0.16.3-plan.md) |
| 0.17.0 | Self-signed `AppleConnector.app` as the TCC identity | [plan](v0.17.0-plan.md) · [progress](v0.17.0-progress.md) |

For versions before 0.2.0, both plan and progress records are linked. For later releases
the table links each plan; every plan has a matching `-progress.md` file in this directory.
