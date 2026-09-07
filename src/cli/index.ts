#!/usr/bin/env node
import { appVersion } from '../application/version.js';
import { capabilities } from '../application/capabilities.js';
import { publicError } from '../application/errors.js';
import { JxaRunner } from '../jxa/runner.js';
import { HttpServiceClient } from '../transports/local/client.js';
import { health, issueManagementUrl, setup, startForegroundService, startService, status, stopService } from '../transports/local/lifecycle.js';
import { spawn } from 'node:child_process';
import { readAdminToken, statePaths, writeClientToken } from '../transports/local/paths.js';
import { resolve } from 'node:path';
import { runMcpEntry } from '../transports/mcp/index.js';
import { runJournaledReminderM1Diagnostic, recoverJournaledReminderM1Diagnostic } from '../application/diagnostic-journal.js';
import type { RpcMethod } from '../transports/local/rpc.js';

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

try {
  switch (command) {
    case undefined:
    case '--help':
    case '-h':
      console.log(`Apple Connector ${appVersion} — development prototype

Usage: apple-connector <command>

  setup                Create the state directory, admin session and database
  start                Start or reuse the local background service
  start --foreground   Replace any running service and stay attached to this terminal
  stop                 Stop the local background service
  status               Show service, database and client summary
  client list          List paired clients
  client create        Pair a client (--name <name> --grant <json>, repeatable)
                      Grant: provider, containerIds, actions, fields, approval, expiresAt
                      (expiresAt is Unix epoch milliseconds, the Date.now() scale)
                      Optional --credential-file <absolute-path> stores its token as 0600
  client revoke        Revoke a client (--id <client-id>)
  client update        Replace name/access (--id <id> --name <name> --grant <json>, repeatable)
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
The service refuses native writes until the M0 capability gate passes.`);
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

    case 'client': {
      const sub = args[0];
      if (sub === 'list') {
        if (args.length !== 1) throw new Error('Unexpected arguments');
        const clients = (await admin('clients.list', undefined)) as Array<{ id: string; name: string; revoked: boolean; policyVersion: number }>;
        for (const c of clients) console.log(`${c.revoked ? 'revoked ' : 'active  '} ${c.name}  ${c.id}  policy v${c.policyVersion}`);
      } else if (sub === 'create') {
        const name = flagValue('--name');
        if (!name) throw new Error('client create requires --name <name>');
        const grants: unknown[] = [];
        args.forEach((arg, i) => { if (arg === '--grant' && args[i + 1]) grants.push(JSON.parse(args[i + 1] as string)); });
        if (!grants.length) throw new Error('client create requires at least one --grant <json>');
        const created = (await admin('clients.create', { name, grants })) as { client: { id: string; name: string }; token: string };
        const credentialFile = flagValue('--credential-file');
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
        const id = flagValue('--id');
        const name = flagValue('--name');
        if (!id || !name) throw new Error('client update requires --id <client-id> --name <name>');
        const grants: unknown[] = [];
        args.forEach((arg, i) => { if (arg === '--grant' && args[i + 1]) grants.push(JSON.parse(args[i + 1] as string)); });
        const updated = await admin('clients.update', { id, name, grants }) as { id: string; policyVersion: number };
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
        // argv[1] and execPath are absolute in normal Node invocation. Resolving preserves the
        // contract for packaged wrappers too, without depending on a login-shell PATH.
        console.log(JSON.stringify({ mcpServers: { 'apple-connector': {
          command: process.execPath, args: [resolve(process.argv[1] ?? '') , 'mcp'],
          env: { APPLE_CONNECTOR_TOKEN_FILE: credentialFile, APPLE_CONNECTOR_STATE_DIR: statePaths().dir },
        } } }, null, 2));
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
