#!/usr/bin/env node
import { appVersion } from '../application/version.js';
import { capabilities } from '../application/capabilities.js';
import { publicError } from '../application/errors.js';
import { JxaRunner } from '../jxa/runner.js';
import { HttpServiceClient } from '../transports/local/client.js';
import { health, issueManagementUrl, setup, startForegroundService, startService, status, stopService } from '../transports/local/lifecycle.js';
import { spawn } from 'node:child_process';
import { readAdminToken, readClientToken, statePaths, writeClientToken } from '../transports/local/paths.js';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { runMcpEntry } from '../transports/mcp/index.js';
import { runJournaledReminderM1Diagnostic, recoverJournaledReminderM1Diagnostic } from '../application/diagnostic-journal.js';
import type { RpcMethod } from '../transports/local/rpc.js';
import { readClientCreateConfig, readClientUpdateConfig, writeDefaultAgentClientConfig } from './client-config.js';

const [command, ...args] = process.argv.slice(2);

function adminRpc(): { client: HttpServiceClient; token: string } {
  const paths = statePaths();
  return { client: new HttpServiceClient(paths.socket), token: readAdminToken(paths) };
}

async function admin(method: RpcMethod, params: Record<string, unknown> | undefined): Promise<unknown> {
  const { client, token } = adminRpc();
  return client.request(method, params, token);
}

function flagValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function openManagement(url: string): boolean {
  if (process.platform !== 'darwin') return false;
  const opener = spawn('/usr/bin/open', [url], { detached: true, stdio: 'ignore' });
  opener.unref();
  return true;
}

function mcpConfiguration(credentialFile: string): Record<string, unknown> {
  return { mcpServers: { 'apple-connector': {
    command: process.execPath, args: [resolve(process.argv[1] ?? ''), 'mcp'],
    env: { APPLE_CONNECTOR_TOKEN_FILE: credentialFile,
      ...(process.env.APPLE_CONNECTOR_STATE_DIR ? { APPLE_CONNECTOR_STATE_DIR: statePaths().dir } : {}),
    },
  } } };
}

try {
  switch (command) {
    case undefined:
    case '--help':
    case '-h':
      console.log(`Apple Connector ${appVersion} — local MCP service

Usage: apple-connector <command>

  setup                Create the state directory, admin session and database
  start                Start or reuse the local background service
  start --foreground   Replace any running service and stay attached to this terminal
  stop                 Stop the local background service
  status               Show service, database and client summary
  agent init            Create the default agent policy and credential, then print MCP config
  client list          List paired clients
  client create        Pair a client (--config <absolute-path>)
                      Config: { name, grants }; grants contain provider, containerIds,
                      actions, fields, approval and expiresAt (Unix epoch milliseconds)
                      Optional --credential-file <absolute-path> stores its token as 0600
  client revoke        Revoke a client (--id <client-id>)
  client update        Replace name/access (--config <absolute-path>)
                      Config: { id, name, grants }
  client rotate        Rotate a client credential (--id <client-id>; replacement shown once)
  mcp                  Run the stdio MCP entry (requires APPLE_CONNECTOR_TOKEN_FILE)
  mcp config           Print a stdio MCP configuration; does not edit an agent configuration
  open                 Open the local management interface (requires a running service)
  doctor [--probe]     Inspect runtime; --probe checks JXA/EventKit without personal-data access
  doctor --containers <name>
                       Find IDs of exactly named Reminders lists; no item content is read
  doctor --reminders-m1 <list-id>
                       Run a UUID-journaled create/update/complete/cleanup diagnostic in one test list
  doctor --reminders-m1-recover <probe-uuid>
                       Retry only the exact cleanup recorded by an existing diagnostic journal
  version              Print version
  --help               Print this help

The management UI runs only on loopback and requires a one-time setup link.
Agent writes always require an unexpired container/action grant and a stable idempotency key.`);
      break;

    case 'version':
      if (args.length) throw new Error('Unexpected arguments');
      console.log(`apple-connector ${appVersion}`);
      break;

    case 'setup': {
      if (args.length) throw new Error('Unexpected arguments');
      const result = setup();
      const started = await startService();
      const opened = openManagement(started.url);
      const tokenNotice = result.adminTokenCreated
        ? `Administrator token (store it securely; shown once):\n${result.adminToken}`
        : 'Administrator token: already configured (not displayed again).';
      console.log(`Apple Connector ${result.version} — state initialised.
State directory: ${result.paths.dir}
${tokenNotice}
Reference: keep it out of the agent environment; management actions use it locally.
Management URL: ${started.url}
${opened ? 'The one-time local management session was opened in your browser.' : 'Run `apple-connector open` on macOS to establish a browser session.'}`);
      break;
    }

    case 'start':
      if (args.length && !(args.length === 1 && (args[0] === '--open' || args[0] === '--foreground'))) throw new Error('Unexpected arguments');
      if (args[0] === '--foreground') {
        const foreground = await startForegroundService();
        console.log(`apple-connector service running in foreground (pid ${foreground.pid}).\nManagement URL: ${foreground.url}\nPress Ctrl-C to stop.`);
      } else {
        const started = await startService();
        const opened = args[0] === '--open' ? openManagement(started.url) : false;
        console.log(`apple-connector service ${started.started ? 'started' : 'already running'} (pid ${started.pid}).\nManagement URL: ${started.url}${args[0] === '--open' && !opened ? '\nBrowser could not be opened; copy the URL above.' : ''}`);
      }
      break;

    case 'stop':
      if (args.length) throw new Error('Unexpected arguments');
      await stopService();
      console.log('apple-connector service stopped.');
      break;

    case 'status': {
      if (args.length) throw new Error('Unexpected arguments');
      const s = status();
      const serviceHealth = await health();
      console.log(`apple-connector ${s.version}
status:        ${s.running ? `${serviceHealth.healthy ? 'healthy' : `degraded: ${serviceHealth.reason}`} (pid ${s.pid})` : 'stopped'}
state dir:     ${s.paths.dir}
db bytes:      ${s.dbBytes ?? 'n/a'}
clients:       ${s.clients}
operations:    ${s.operations}
admin session: ${s.adminTokenFileExists ? 'present' : 'missing (run setup)'}
management:    ${s.running ? (s.managementAddress ?? 'starting') : 'stopped (run start)'}`);
      break;
    }

    case 'agent': {
      if (args.length !== 1 || args[0] !== 'init') throw new Error('Usage: apple-connector agent init');
      const initialized = setup();
      const configFile = join(initialized.paths.dir, 'agent-client.json');
      const credentialFile = join(initialized.paths.dir, 'agent.token');
      if (existsSync(credentialFile) && !existsSync(configFile)) {
        throw new Error('agent.token exists without agent-client.json; use `mcp config --token-file` for this existing credential.');
      }
      let createdConfig = false;
      if (!existsSync(configFile)) {
        writeDefaultAgentClientConfig(configFile);
        createdConfig = true;
      }
      const config = readClientCreateConfig(configFile);
      if (config.grants.some((grant) => grant.expiresAt <= Date.now())) {
        throw new Error('agent-client.json contains an expired grant; review it and set a future Unix-millisecond expiry before pairing.');
      }
      let createdCredential = false;
      await startService();
      if (!existsSync(credentialFile)) {
        const created = (await admin('clients.create', config)) as { client: { id: string; name: string }; token: string };
        writeClientToken(credentialFile, created.token);
        createdCredential = true;
      } else {
        const token = readClientToken(credentialFile);
        await new HttpServiceClient(initialized.paths.socket).request('capabilities', {}, token);
      }
      console.log(`Agent initialization complete.
Policy:     ${configFile}${createdConfig ? ' (created)' : ' (reused)'}
Credential: ${credentialFile}${createdCredential ? ' (created, owner-only)' : ' (reused)'}

Add the following stdio MCP entry to your agent host configuration:\n${JSON.stringify(mcpConfiguration(credentialFile), null, 2)}`);
      break;
    }

    case 'client': {
      const sub = args[0];
      if (sub === 'list') {
        if (args.length !== 1) throw new Error('Unexpected arguments');
        const clients = (await admin('clients.list', undefined)) as Array<{ id: string; name: string; revoked: boolean; policyVersion: number }>;
        for (const c of clients) console.log(`${c.revoked ? 'revoked ' : 'active  '} ${c.name}  ${c.id}  policy v${c.policyVersion}`);
      } else if (sub === 'create') {
        const configFile = flagValue('--config');
        const credentialFile = flagValue('--credential-file');
        const expected = credentialFile
          ? ['create', '--config', configFile, '--credential-file', credentialFile]
          : ['create', '--config', configFile];
        if (!configFile || args.length !== expected.length || expected.some((value, index) => args[index] !== value)) {
          throw new Error('client create requires --config <absolute-path> (and optional --credential-file <absolute-path>)');
        }
        const created = (await admin('clients.create', readClientCreateConfig(configFile))) as { client: { id: string; name: string }; token: string };
        if (credentialFile) {
          if (credentialFile !== resolve(credentialFile)) throw new Error('client create --credential-file must be an absolute path');
          writeClientToken(credentialFile, created.token);
          console.log(`Client "${created.client.name}" ${created.client.id}\nCredential saved to ${credentialFile} (owner-only).`);
        } else console.log(`Client "${created.client.name}" ${created.client.id}
Token (shown once, keep it in the agent environment):
${created.token}`);
      } else if (sub === 'revoke') {
        const id = flagValue('--id');
        if (!id) throw new Error('client revoke requires --id <client-id>');
        await admin('clients.revoke', { id });
        console.log(`Revoked client ${id}; pending plans are cancelled.`);
      } else if (sub === 'update') {
        const configFile = flagValue('--config');
        if (!configFile || args.length !== 3 || args[1] !== '--config') throw new Error('client update requires --config <absolute-path>');
        const updated = await admin('clients.update', { ...readClientUpdateConfig(configFile) }) as { id: string; policyVersion: number };
        console.log(`Updated client ${updated.id}; policy v${updated.policyVersion}. Pending unexecuted plans were cancelled.`);
      } else if (sub === 'rotate') {
        const id = flagValue('--id');
        if (!id) throw new Error('client rotate requires --id <client-id>');
        const rotated = await admin('clients.rotate', { id }) as { client: { id: string; name: string }; token: string };
        console.log(`Rotated credential for "${rotated.client.name}" ${rotated.client.id}.\nReplacement token (shown once):\n${rotated.token}`);
      } else throw new Error('Unknown client subcommand; use list, create, update, rotate or revoke.');
      break;
    }

    case 'mcp': {
      const sub = args[0];
      if (sub === 'config') {
        const credentialFile = flagValue('--token-file');
        if (!credentialFile) throw new Error('mcp config requires --token-file <absolute-path>');
        if (credentialFile !== resolve(credentialFile)) throw new Error('mcp config --token-file must be an absolute path');
        if (args.length !== 3 || args[1] !== '--token-file') throw new Error('Unexpected arguments');
        // Absolute executable and entry paths do not depend on a GUI host inheriting shell PATH.
        console.log(JSON.stringify(mcpConfiguration(credentialFile), null, 2));
      } else {
        if (args.length) throw new Error('Unexpected arguments');
        await runMcpEntry();
      }
      break;
    }

    case 'open': {
      if (args.length && !(args.length === 1 && args[0] === '--print')) throw new Error('Unexpected arguments');
      const url = await issueManagementUrl();
      if (args[0] === '--print') { console.log(url); break; }
      if (process.platform !== 'darwin') throw new Error(`The management browser launcher is available only on macOS. Open this URL manually: ${url}`);
      openManagement(url);
      console.log(`Opened Apple Connector management interface.\nManagement URL: ${url}`);
      break;
    }

    case 'doctor': {
      const containerName = args[0] === '--containers' ? args[1] : undefined;
      const remindersM1List = args[0] === '--reminders-m1' ? args[1] : undefined;
      const recoveryProbeId = args[0] === '--reminders-m1-recover' ? args[1] : undefined;
      if (!((args.length === 0) || (args.length === 1 && args[0] === '--probe') ||
        (args.length === 2 && typeof containerName === 'string' && containerName.length > 0) ||
        (args.length === 2 && typeof remindersM1List === 'string' && remindersM1List.length > 0) ||
        (args.length === 2 && typeof recoveryProbeId === 'string' && recoveryProbeId.length > 0))) {
        throw new Error('Unexpected arguments');
      }
      if ((remindersM1List || recoveryProbeId) && process.platform !== 'darwin') throw new Error('Reminders diagnostics require macOS.');
      const runner = new JxaRunner();
      const native = args[0] === '--probe' && process.platform === 'darwin' ? await runner.run('diagnostics.probe')
        : containerName && process.platform === 'darwin' ? await runner.run('diagnostics.findTestContainers', { name: containerName })
        : remindersM1List ? await runJournaledReminderM1Diagnostic(runner, statePaths().dir, remindersM1List)
        : recoveryProbeId ? await recoverJournaledReminderM1Diagnostic(runner, statePaths().dir, recoveryProbeId) : null;
      console.log(JSON.stringify({
        version: appVersion, platform: process.platform, arch: process.arch,
        node: process.version, native, capabilities: capabilities(),
        note: containerName ? 'Container discovery returns Reminders metadata only; it does not read item content.'
          : remindersM1List || recoveryProbeId ? 'The diagnostic journal is retained for exact recovery and contains no reminder body.'
          : 'Bridge visibility does not establish data access, permission attribution or write safety.',
      }, null, 2));
      if (process.platform !== 'darwin') process.exitCode = 1;
      break;
    }

    default:
      console.error('Unknown or not-yet-implemented command. Run apple-connector --help.');
      process.exitCode = 2;
  }
} catch (error) {
  console.error(JSON.stringify(publicError(error)));
  process.exitCode = 1;
}
