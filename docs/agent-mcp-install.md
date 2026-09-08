# Apple Connector: agent integration guide

[中文](agent-mcp-install_zh.md) · [Back to README](../README.md)

This document can be given directly to an Agent responsible for configuring a local agent host. Its goal is to connect Apple Connector over stdio MCP without replacing existing host settings.

## Constraints

- Install the published `@jachy/apple-connector@0.8.3` package only after confirming macOS Apple Silicon and Node 24.20.x or 26.8.x. Do not build from source or use `npm link`.
- Do not read, display, copy, or manually create token content. Store only the absolute credential-file path in host configuration.
- Never use the administrator token as an agent credential.
- Merge one `apple-connector` MCP server entry; never replace the complete host configuration.
- Verify with reads only. Do not create, update, complete, or delete real Apple data during setup.

## Standard procedure

1. Confirm `uname -m` is `arm64` and `node --version` is in the supported 24.20.x or 26.8.x line. Run `npm install -g @jachy/apple-connector@0.8.3`, then run `command -v apple-connector` and `apple-connector version`. Stop and report an unsupported platform, Node version, or missing command.
2. Run `apple-connector agent init`. It initializes local state, writes `agent-client.json`, pairs the client, creates the owner-only `agent.token`, and only then prints MCP JSON. Do not reference a nonexistent `APPLE_CONNECTOR_TOKEN_FILE` before this finishes.
3. Review `~/apple-connector/agent-client.json` without reading the token. The policy must grant only `read` across all Calendar and Reminders containers. Exact-name `Agents` scopes additionally grant Calendar `create`/`update`/`delete` and Reminders `create`/`update`/`complete`/`delete`, expiring one year after generation.
4. Merge the printed `mcpServers.apple-connector` entry into the host's stdio MCP location. Preserve the absolute `command`, `args`, and `env.APPLE_CONNECTOR_TOKEN_FILE`. Keep `APPLE_CONNECTOR_STATE_DIR` only when initialization used a custom state directory. If supported, configure a tool timeout above 60 seconds, such as 90 seconds.
5. Restart or reload the host. Verify only with `connector.capabilities`, `calendar.list_calendars`, and `reminders.list_lists`.

Success means the host exposes Apple Connector tools, capabilities report version 0.8.3, Calendar and Reminders containers can be listed, and all existing host settings remain intact. Apple Notes reporting unavailable is expected. Missing or duplicate `Agents` containers may leave reads working while writes are safely rejected.

If the user explicitly supplies an existing owner-only credential, skip initialization and run:

```sh
apple-connector mcp config --token-file /absolute/path/agent.token
```

Then continue from configuration merge and read-only verification. For a custom authorization policy, stop and follow the [full MCP setup guide](mcp-setup.md) with the user or maintainer before pairing.
