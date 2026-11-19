#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { appVersion } from '../application/version.js';
import { publicError, ConnectorError } from '../application/errors.js';
import { JxaRunner } from '../jxa/runner.js';
import { EventKitHelperClient } from '../native/helper-client.js';
import { HttpServiceClient } from '../transports/local/client.js';
import { health, openManagementWeb, startForegroundService, startService, status, stopService } from '../transports/local/lifecycle.js';
import { migrateLegacyStateSync, migrateLegacyStateWithStop, readClientToken, readClientTokenByKey, statePaths } from '../transports/local/paths.js';
import type { RpcMethod } from '../transports/local/rpc.js';
import { parseDueInput, parseDuePatch } from './due.js';
import { createUi, resolveColorEnabled } from './ui.js';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const noColor = argv.includes('--no-color');
const words = argv.filter((value) => value !== '--json' && value !== '--no-color');
const [command, subcommand, ...rest] = words;
const schemaVersion = 2;
const ui = createUi(resolveColorEnabled({ json, noColor, colorSupported: pc.isColorSupported }));
function result<T>(data: T, format?: (value: T) => string): void {
  if (json) { process.stdout.write(`${JSON.stringify({ ok: true, data, meta: { schemaVersion } })}\n`); return; }
  const output = format ? format(data) : typeof data === 'string' ? data : ui.json(data);
  process.stdout.write(`${output}\n`);
}
function flag(name: string): string | undefined { const i = rest.indexOf(name); const v = rest[i + 1]; return i >= 0 && v && !v.startsWith('--') ? v : undefined; }
function required(name: string): string { const value = flag(name); if (!value) throw new ConnectorError('invalid_request', `Missing required ${name}.`); return value; }
function has(name: string): boolean { return rest.includes(name); }
function input(): Record<string, unknown> { const path = flag('--input'); if (!path) return {}; try { const value: unknown = JSON.parse(readFileSync(path, 'utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; } catch { throw new ConnectorError('invalid_request', '--input must name a JSON object file.'); } }
function textInput(name: string): string | undefined { const value = flag(name); if (value !== undefined) return value; const fileValue = input()[name.slice(2)]; return typeof fileValue === 'string' ? fileValue : undefined; }
function agentClient(): { client: HttpServiceClient; token: string } {
  const authFile = flag('--auth-file');
  const direct = flag('--auth') ?? process.env.APPLE_CONNECTOR_AUTH?.trim();
  const key = flag('--auth-key') ?? flag('--profile');
  const credential = flag('--credential-file');
  const token = authFile
    ? readClientToken(authFile)
    : direct !== undefined && direct !== ''
      ? direct
      : key
        ? readClientTokenByKey(statePaths(), key)
        : readClientToken(credential ?? `${statePaths().dir}/profiles/default.token`);
  if (!token || /\s/.test(token)) throw new ConnectorError('invalid_request', 'Authorization ID is invalid.');
  return { client: new HttpServiceClient(statePaths().socket), token };
}
async function agent(method: RpcMethod, params: Record<string, unknown>): Promise<unknown> { const rpc = agentClient(); await startService(); return rpc.client.request(method, params, rpc.token); }
async function mutation(change: Record<string, unknown>): Promise<unknown> { return agent('operations.submit', { idempotencyKey: required('--idempotency-key'), change }); }

async function run(): Promise<void> {
  const helpRequested = argv.includes('--help') || argv.includes('-h');
  if (!command || command === 'help' || command === '--help' || command === '-h' || helpRequested) {
    const topic = command === 'help'
      ? [subcommand, ...rest].filter((value): value is string => Boolean(value))
      : command && !command.startsWith('-')
        ? [command, ...(subcommand && !subcommand.startsWith('-') ? [subcommand] : [])]
        : [];
    const text = ui.help(topic);
    if (text === undefined) throw new ConnectorError('invalid_request', `Unknown help topic: ${topic.join(' ')}.`);
    return result(text);
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    if (subcommand) throw new ConnectorError('invalid_request', 'Unexpected arguments.');
    return result({ version: appVersion }, () => ui.version());
  }
  if (command === 'migrate-state') {
    if (subcommand) throw new ConnectorError('invalid_request', 'Unexpected arguments.');
    return result(await migrateLegacyStateWithStop(), (value) => ui.migrateState(value));
  }
  if (['init', 'start', 'stop', 'status', 'open', 'auth', 'operation', 'calendar', 'reminder'].includes(command)) {
    migrateLegacyStateSync();
  }
  if (command === 'start') { if (subcommand && subcommand !== '--foreground') throw new ConnectorError('invalid_request', 'Unexpected arguments.'); const started = subcommand === '--foreground' ? await startForegroundService() : await startService(); return result({ pid: started.pid, started: started.started }, (value) => ui.start(value)); }
  if (command === 'stop') { if (subcommand) throw new ConnectorError('invalid_request', 'Unexpected arguments.'); await stopService(); return result({ stopped: true }, () => ui.stop()); }
  if (command === 'status') { if (subcommand) throw new ConnectorError('invalid_request', 'Unexpected arguments.'); return result({ ...status(), health: await health() }, (value) => ui.status(value)); }
  if (command === 'skill' && subcommand === 'path') {
    if (rest.length) throw new ConnectorError('invalid_request', 'Unexpected arguments.');
    return result({ path: fileURLToPath(new URL('../../../skill', import.meta.url)), version: appVersion }, (value) => ui.skill(value));
  }
  if (command === 'init' || command === 'open') {
    const requestedSection = subcommand === '--section' ? rest[0] : 'setup';
    // `permissions` and `agents` are retained as aliases for links issued before the pages
    // were merged into the single setup flow.
    const section = requestedSection === 'permissions' || requestedSection === 'agents' ? 'setup' : requestedSection;
    if (!section || !['setup', 'audit', 'docs'].includes(section)) throw new ConnectorError('invalid_request', 'Invalid management section.');
    const opened = await openManagementWeb();
    const url = `${opened.url}${opened.url.includes('?') ? '&' : '?'}section=${encodeURIComponent(section)}`;
    if (!json && process.platform === 'darwin') { const child = spawn('/usr/bin/open', [url], { detached: true, stdio: 'ignore' }); child.unref(); }
    return result({ url, expiresAt: opened.expiresAt, remainingSeconds: opened.remainingSeconds, section }, (value) => command === 'init' ? ui.init(value) : ui.open(value));
  }
  if (command === 'auth' && subcommand === 'show') return result(await agent('auth.describe', {}), (value) => ui.authShow(value as Parameters<typeof ui.authShow>[0]));
  if (command === 'auth' && subcommand === 'verify') return result(await agent('auth.verify', { agent: required('--agent') }), (value) => ui.authVerify(value as Parameters<typeof ui.authVerify>[0]));
  if (command === 'operation' && subcommand === 'get') return result(await agent('operations.get', { id: required('--id') }));
  if (command === 'calendar') {
    if (subcommand === 'list-calendars') return result(await agent('calendar.list_calendars', {}));
    if (subcommand === 'list') return result(await agent('calendar.list_events', { calendarId: required('--calendar-id'), from: required('--from'), to: required('--to'), offset: Number(flag('--offset') ?? 0), limit: Number(flag('--limit') ?? 50) }));
    const base = input();
    if (subcommand === 'create') return result(await mutation({ ...base, kind: 'calendar.create', containerId: required('--calendar-id'), title: textInput('--title'), start: required('--start'), end: required('--end'), allDay: has('--all-day'), location: textInput('--location') ?? '', notes: textInput('--notes') ?? '' }));
    if (subcommand === 'update') return result(await mutation({ ...base, kind: 'calendar.update', containerId: required('--calendar-id'), id: required('--id'), title: textInput('--title'), start: required('--start'), end: required('--end'), allDay: has('--all-day'), location: textInput('--location') ?? '', notes: textInput('--notes') ?? '' }));
    if (subcommand === 'delete') return result(await mutation({ kind: 'calendar.delete', containerId: required('--calendar-id'), id: required('--id') }));
  }
  if (command === 'reminder') {
    if (subcommand === 'list-lists') return result(await agent('reminders.list_lists', {}));
    if (subcommand === 'list') return result(await agent('reminders.list', { listId: required('--list-id'), offset: Number(flag('--offset') ?? 0), limit: Number(flag('--limit') ?? 50) }));
    const base = input();
    if (subcommand === 'create') return result(await mutation({ ...base, kind: 'reminders.create', containerId: required('--list-id'), title: textInput('--title'), body: textInput('--body') ?? '', ...parseDueInput(rest) }));
    if (subcommand === 'update') return result(await mutation({ ...base, kind: 'reminders.update', containerId: required('--list-id'), id: required('--id'), title: textInput('--title'), body: textInput('--body') ?? '', completed: has('--completed') }));
    if (subcommand === 'patch') {
      if (has('--title') || has('--body')) throw new ConnectorError('invalid_request', 'Pass title/body through --input, not command-line flags.');
      if (has('--completed') && has('--not-completed')) throw new ConnectorError('invalid_request', 'Use either --completed or --not-completed, not both.');
      const completed = has('--completed') ? true : has('--not-completed') ? false : undefined;
      return result(await mutation({ ...base, kind: 'reminders.patch', containerId: required('--list-id'), id: required('--id'), ...parseDuePatch(rest), ...(completed === undefined ? {} : { completed }) }));
    }
    if (subcommand === 'complete') return result(await mutation({ kind: 'reminders.complete', containerId: required('--list-id'), id: required('--id') }));
    if (subcommand === 'delete') return result(await mutation({ kind: 'reminders.delete', containerId: required('--list-id'), id: required('--id') }));
  }
  if (command === 'doctor') {
    if (subcommand && subcommand !== '--probe') throw new ConnectorError('invalid_request', 'Unexpected arguments.');
    const native = subcommand === '--probe' && process.platform === 'darwin' ? await new JxaRunner().run('diagnostics.probe') : null;
    const helperState = status().helper;
    let helperPermissions: unknown = null;
    if (helperState.running) {
      const client = new EventKitHelperClient({ socketPath: helperState.socket });
      try { helperPermissions = await client.call('permissions.status', {}, 5_000); }
      catch { helperPermissions = null; }
      finally { await client.close(); }
    }
    return result({ version: appVersion, platform: process.platform, arch: process.arch, node: process.version, native, helper: { running: helperState.running, permissions: helperPermissions } }, (value) => ui.doctor(value));
  }
  throw new ConnectorError('invalid_request', 'Unknown command. Run apple-connector help.');
}
run().catch((error) => { const detail = publicError(error); if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: detail, meta: { schemaVersion } })}\n`); else process.stderr.write(`${ui.error(detail)}\n`); process.exitCode = detail.code === 'invalid_request' ? 2 : detail.code === 'outcome_unknown' ? 4 : 1; });
