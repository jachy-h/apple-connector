# One-time MCP setup

[中文](mcp-setup_zh.md) · [Back to README](../README.md)

This guide is for the person or configuration agent installing Apple Connector for any local agent host.

## Standard flow

1. Confirm that `apple-connector` is installed with `command -v apple-connector` and `apple-connector version`.
2. Run `apple-connector agent init`.
3. Review `~/apple-connector/agent-client.json`.
4. Merge the printed `apple-connector` entry into the host's stdio MCP configuration without replacing existing tools, then reload the host.
5. Verify with the read-only `connector.capabilities`, `calendar.list_calendars`, and `reminders.list_lists` tools.

Initialization deliberately runs in this order: local setup, default policy file, paired client, owner-only `agent.token`, and finally MCP JSON. `APPLE_CONNECTOR_TOKEN_FILE` is not requested before its target exists.

The default policy grants `read` on `*` for Calendar and Reminders. Separate `Agents` name scopes grant Calendar `create`, `update`, and `delete`, plus Reminders `create`, `update`, `complete`, and `delete`. Its generated Unix-millisecond expiry is one year in the future. Existing files are reused or rejected safely, never overwritten automatically.

## Existing credentials and custom policy

For an existing private credential, print configuration with:

```sh
apple-connector mcp config --token-file /absolute/path/agent.token
```

For manual pairing, first create and review an absolute-path `{ name, grants }` JSON file, then run:

```sh
apple-connector start
apple-connector client create \
  --config /absolute/path/agent-client.json \
  --credential-file /absolute/path/agent.token
apple-connector mcp config --token-file /absolute/path/agent.token
```

The credential parent directory must already exist and the target must not. Never place token content in prompts, command arguments, logs, or version control. `APPLE_CONNECTOR_STATE_DIR` is needed only for an explicit custom state directory; the default is `~/apple-connector`.

## Source installation and limitations

For a first source checkout or changed lockfile, run `npm ci`, `npm run build`, and `npm link --offline --no-audit --no-fund`. Do not repeat dependency installation for ordinary MCP startup. There is currently no signed app installer.

The EventKit helper needs macOS Calendar and Reminders permission independently of client policy. Missing or duplicate `Agents` containers reject default writes. Apple Notes is disabled, and recurring Calendar events and recurring reminders cannot be updated or deleted. Configure a host tool timeout above the connector's 60-second RPC limit when supported (90 seconds is a reasonable value).
