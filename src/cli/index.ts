#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appVersion } from '../application/version.js';
import { publicError, ConnectorError } from '../application/errors.js';
import { JxaRunner } from '../jxa/runner.js';
import { HttpServiceClient } from '../transports/local/client.js';
import { createOnboarding, health, onboardingStatus, openManagementWeb, setup, startForegroundService, startService, status, stopService } from '../transports/local/lifecycle.js';
import { readClientToken, statePaths } from '../transports/local/paths.js';
import type { RpcMethod } from '../transports/local/rpc.js';
import { parseDueInput } from './due.js';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const words = argv.filter((value) => value !== '--json');
const [command, subcommand, ...rest] = words;
const schemaVersion = 1;
function result(data: unknown): void { if (json) process.stdout.write(`${JSON.stringify({ ok: true, data, meta: { schemaVersion } })}\n`); else console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2)); }
function flag(name: string): string | undefined { const i = rest.indexOf(name); const v = rest[i + 1]; return i >= 0 && v && !v.startsWith('--') ? v : undefined; }
function required(name: string): string { const value = flag(name); if (!value) throw new ConnectorError('invalid_request', `Missing required ${name}.`); return value; }
function has(name: string): boolean { return rest.includes(name); }
function input(): Record<string, unknown> { const path = flag('--input'); if (!path) return {}; try { const value: unknown = JSON.parse(readFileSync(path, 'utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; } catch { throw new ConnectorError('invalid_request', '--input must name a JSON object file.'); } }
function textInput(name: string): string | undefined { const value = flag(name); if (value !== undefined) return value; const fileValue = input()[name.slice(2)]; return typeof fileValue === 'string' ? fileValue : undefined; }
function agentClient(): { client: HttpServiceClient; token: string } { const credential = flag('--credential-file') ?? `${statePaths().dir}/profiles/${flag('--profile') ?? 'default'}.token`; return { client: new HttpServiceClient(statePaths().socket), token: readClientToken(credential) }; }
async function agent(method: RpcMethod, params: Record<string, unknown>): Promise<unknown> { const rpc = agentClient(); await startService(); return rpc.client.request(method, params, rpc.token); }
async function mutation(change: Record<string, unknown>): Promise<unknown> { return agent('operations.submit', { idempotencyKey: required('--idempotency-key'), change }); }
function help(): string { return `Apple Connector ${appVersion} — local Calendar and Reminders CLI

Usage: apple-connector <command> [--json]
  setup | start [--foreground] | stop | status | open [--section permissions|agents|approvals|audit]
  agent init | init-status --id <onboarding-id> | skill path
  calendar list-calendars | list | create | update | delete
  reminder list-lists | list | create | update | complete | delete
  operation get --id <operation-id> | doctor [--probe] | version

Business commands require --profile <name> or --credential-file <absolute-path>. Writes require --idempotency-key. Use --input <owner-only JSON file> for private title/body/notes fields.`; }

async function run(): Promise<void> {
  if (!command || command === '--help' || command === '-h') return result(help());
  if (command === 'version') { if (subcommand) throw new ConnectorError('invalid_request', 'Unexpected arguments.'); return result({ version: appVersion }); }
  if (command === 'setup') { if (subcommand) throw new ConnectorError('invalid_request', 'Unexpected arguments.'); const initialized = setup(); const started = await startService(); return result({ stateDirectory: initialized.paths.dir, servicePid: started.pid, serviceStarted: started.started }); }
  if (command === 'start') { if (subcommand && subcommand !== '--foreground') throw new ConnectorError('invalid_request', 'Unexpected arguments.'); const started = subcommand === '--foreground' ? await startForegroundService() : await startService(); return result({ pid: started.pid, started: started.started }); }
  if (command === 'stop') { if (subcommand) throw new ConnectorError('invalid_request', 'Unexpected arguments.'); await stopService(); return result({ stopped: true }); }
  if (command === 'status') { if (subcommand) throw new ConnectorError('invalid_request', 'Unexpected arguments.'); return result({ ...status(), health: await health() }); }
  if (command === 'skill' && subcommand === 'path') {
    if (rest.length) throw new ConnectorError('invalid_request', 'Unexpected arguments.');
    return result({ path: fileURLToPath(new URL('../../../skill', import.meta.url)), version: appVersion });
  }
  if (command === 'agent' && subcommand === 'init-status') return result(await onboardingStatus(required('--id')));
  if (command === 'open' || (command === 'agent' && subcommand === 'init')) {
    const initialWeb = command === 'agent' ? await openManagementWeb() : undefined;
    const onboarding = command === 'agent' ? await createOnboarding(initialWeb!.expiresAt) : undefined;
    const requestedSection = command === 'open' && subcommand === '--section' ? rest[0] : 'permissions';
    if (!requestedSection || !['permissions', 'agents', 'approvals', 'audit'].includes(requestedSection)) throw new ConnectorError('invalid_request', 'Invalid management section.');
    const section = requestedSection;
    const opened = command === 'agent' ? await openManagementWeb(onboarding!.onboardingId) : await openManagementWeb();
    const url = `${opened.url}${opened.url.includes('?') ? '&' : '?'}section=${encodeURIComponent(section)}`;
    if (!json && process.platform === 'darwin') { const child = spawn('/usr/bin/open', [url], { detached: true, stdio: 'ignore' }); child.unref(); }
    return result({ ...(onboarding ? { onboardingId: onboarding.onboardingId } : {}), url, expiresAt: opened.expiresAt, remainingSeconds: opened.remainingSeconds, section });
  }
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
    if (subcommand === 'complete') return result(await mutation({ kind: 'reminders.complete', containerId: required('--list-id'), id: required('--id') }));
    if (subcommand === 'delete') return result(await mutation({ kind: 'reminders.delete', containerId: required('--list-id'), id: required('--id') }));
  }
  if (command === 'doctor') { if (subcommand && subcommand !== '--probe') throw new ConnectorError('invalid_request', 'Unexpected arguments.'); const native = subcommand === '--probe' && process.platform === 'darwin' ? await new JxaRunner().run('diagnostics.probe') : null; return result({ version: appVersion, platform: process.platform, arch: process.arch, node: process.version, native }); }
  throw new ConnectorError('invalid_request', 'Unknown command. Run apple-connector --help.');
}
run().catch((error) => { const detail = publicError(error); if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: detail, meta: { schemaVersion } })}\n`); else console.error(detail.message); process.exitCode = detail.code === 'invalid_request' ? 2 : detail.code === 'outcome_unknown' ? 4 : 1; });
