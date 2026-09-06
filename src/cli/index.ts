#!/usr/bin/env node
import { appVersion } from '../application/version.js';
import { capabilities } from '../application/capabilities.js';
import { publicError } from '../application/errors.js';
import { JxaRunner } from '../jxa/runner.js';
import { HttpServiceClient } from '../transports/local/client.js';
import { managementUrl, setup, startService, status, stopService } from '../transports/local/lifecycle.js';
import { spawn } from 'node:child_process';
import { readAdminToken, statePaths } from '../transports/local/paths.js';
import { runMcpEntry } from '../transports/mcp/index.js';
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

function openManagement(): boolean {
  if (process.platform !== 'darwin') return false;
  const opener = spawn('/usr/bin/open', [managementUrl()], { detached: true, stdio: 'ignore' });
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
  start                Start the local background service
  stop                 Stop the local background service
  status               Show service, database and client summary
  client list          List paired clients
  client create        Pair a client (--name <name> --grant <json>, repeatable)
                      Grant: provider, containerIds, actions, fields, approval, expiresAt
                      (expiresAt is Unix epoch milliseconds, the Date.now() scale)
  client revoke        Revoke a client (--id <client-id>)
  mcp                  Run the stdio MCP entry (requires APPLE_CONNECTOR_TOKEN)
  open                 Open the local management interface (requires a running service)
  doctor [--probe]     Inspect runtime; --probe checks JXA/EventKit without personal-data access
  doctor --containers <name>
                       Find IDs of exactly named Reminders lists/Notes folders; no item content is read
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
      if (!status().running) await startService();
      const opened = openManagement();
      const tokenNotice = result.adminTokenCreated
        ? `Administrator token (store it securely; shown once):\n${result.adminToken}`
        : 'Administrator token: already configured (not displayed again).';
      console.log(`Apple Connector ${result.version} — state initialised.
State directory: ${result.paths.dir}
${tokenNotice}
Reference: keep it out of the agent environment; management actions use it locally.
${opened ? 'The one-time local management session was opened in your browser.' : 'Run `apple-connector open` on macOS to establish a browser session.'}`);
      break;
    }

    case 'start':
      if (args.length) throw new Error('Unexpected arguments');
      await startService();
      break;

    case 'stop':
      if (args.length) throw new Error('Unexpected arguments');
      await stopService();
      console.log('apple-connector service stopped.');
      break;

    case 'status': {
      if (args.length) throw new Error('Unexpected arguments');
      const s = status();
      console.log(`apple-connector ${s.version}
status:        ${s.running ? `running (pid ${s.pid})` : 'stopped'}
state dir:     ${s.paths.dir}
db bytes:      ${s.dbBytes ?? 'n/a'}
clients:       ${s.clients}
operations:    ${s.operations}
admin session: ${s.adminTokenFileExists ? 'present' : 'missing (run setup)'}`);
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
        console.log(`Client "${created.client.name}" ${created.client.id}
Token (shown once, keep it in the agent environment):
${created.token}`);
      } else if (sub === 'revoke') {
        const id = flagValue('--id');
        if (!id) throw new Error('client revoke requires --id <client-id>');
        await admin('clients.revoke', { id });
        console.log(`Revoked client ${id}; pending plans are cancelled.`);
      } else throw new Error('Unknown client subcommand; use list, create or revoke.');
      break;
    }

    case 'mcp':
      if (args.length) throw new Error('Unexpected arguments');
      await runMcpEntry();
      break;

    case 'open': {
      if (args.length) throw new Error('Unexpected arguments');
      if (process.platform !== 'darwin') throw new Error('The management browser launcher is available only on macOS.');
      openManagement();
      console.log('Opened Apple Connector management interface.');
      break;
    }

    case 'doctor': {
      const containerName = args[0] === '--containers' ? args[1] : undefined;
      if (!((args.length === 0) || (args.length === 1 && args[0] === '--probe') || (args.length === 2 && typeof containerName === 'string' && containerName.length > 0))) {
        throw new Error('Unexpected arguments');
      }
      const native = args[0] === '--probe' && process.platform === 'darwin' ? await new JxaRunner().run('diagnostics.probe')
        : containerName && process.platform === 'darwin' ? await new JxaRunner().run('diagnostics.findTestContainers', { name: containerName }) : null;
      console.log(JSON.stringify({
        version: appVersion, platform: process.platform, arch: process.arch,
        node: process.version, native, capabilities: capabilities(),
        note: containerName ? 'Container discovery returns metadata only; it does not read reminder or note content.' : 'Bridge visibility does not establish data access, permission attribution or write safety.',
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
