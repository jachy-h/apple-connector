import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { appVersion } from '../../application/version.js';
import { Store } from '../../storage/database.js';
import { ConnectorError } from '../../application/errors.js';
import { loadOrCreateAdminToken, readAdminToken, statePaths } from './paths.js';
import { HttpServiceClient } from './client.js';
import type { StatePaths } from './paths.js';

export interface SetupResult { paths: StatePaths; adminToken?: string; adminTokenCreated: boolean; version: string }
export interface StatusResult {
  running: boolean; pid: number | null; version: string; paths: StatePaths;
  dbBytes: number | null; clients: number; operations: number; adminTokenFileExists: boolean; managementAddress: string | null;
}
export interface StartResult { started: boolean; pid: number }
export interface ManagementResult { url: string; expiresAt: number; remainingSeconds: number; started: boolean }
export interface HealthResult { healthy: boolean; reason?: string | undefined }

/** Initialise the state directory, admin session and schema (idempotent). */
export function setup(): SetupResult {
  const paths = statePaths();
  const adminTokenCreated = !existsSync(paths.adminTokenFile);
  const adminToken = loadOrCreateAdminToken(paths);
  const store = new Store(paths.db); // Runs migration; creating a client here is never needed.
  store.close();
  return { paths, ...(adminTokenCreated ? { adminToken } : {}), adminTokenCreated, version: appVersion };
}

export function status(): StatusResult {
  const paths = statePaths();
  let pid: number | null = null;
  let running = false;
  if (existsSync(paths.pidFile)) {
    try { pid = Number.parseInt(readFileSync(paths.pidFile, 'utf8').trim(), 10); } catch { pid = null; }
    if (pid && Number.isInteger(pid)) {
      try { process.kill(pid, 0); running = true; } catch { running = false; }
    }
  }
  if (running && !existsSync(paths.socket)) running = false;
  let dbBytes: number | null = null;
  let managementAddress: string | null = null;
  try {
    const url = new URL(readFileSync(paths.adminUrlFile, 'utf8').trim());
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1') managementAddress = url.origin;
  } catch { /* The browser link is intentionally transient. */ }
  try { dbBytes = statSync(paths.db).size; } catch { dbBytes = null; }
  let clients = 0; let operations = 0;
  if (dbBytes !== null) {
    try {
      const store = new Store(paths.db);
      clients = store.listClients().length;
      operations = store.listOperations().length;
      store.close();
    } catch { /* A running service owns the DB; status still reports paths. */ }
  }
  return { running, pid, version: appVersion, paths, dbBytes, clients, operations, adminTokenFileExists: existsSync(paths.adminTokenFile), managementAddress };
}

/** Proves that the claimed local service can answer an authenticated management RPC. */
export async function health(): Promise<HealthResult> {
  const current = status();
  if (!current.running) return { healthy: false, reason: 'Service is not running.' };
  try {
    // Service health must not depend on an optional native provider being available. The
    // management diagnostics endpoint probes EventKit separately and reports provider health.
    await new HttpServiceClient(current.paths.socket).request('audit.summary', {}, readAdminToken(current.paths));
    return { healthy: true };
  } catch (error) {
    return { healthy: false, reason: error instanceof ConnectorError ? error.message : 'Local service did not answer its health check.' };
  }
}

function livePid(file: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
    if (!Number.isInteger(pid)) return null;
    process.kill(pid, 0); return pid;
  } catch { return null; }
}

async function issueManagementUrl(onboardingId?: string): Promise<ManagementResult> {
  const paths = statePaths();
  const rawUrl = readFileSync(paths.adminUrlFile, 'utf8').trim();
  let url: string;
  try { const parsed = new URL(rawUrl); if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error(); url = parsed.origin; }
  catch { throw new ConnectorError('service_unavailable', 'Management web URL is invalid.'); }
  return new Promise((resolveIssue, rejectIssue) => {
    const controlUrl = onboardingId ? `${url}/control/issue?onboardingId=${encodeURIComponent(onboardingId)}` : `${url}/control/issue`;
    const req = request(controlUrl, { method: 'POST', headers: { authorization: `Bearer ${readAdminToken(paths)}` }, timeout: 5_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { url?: unknown; expiresAt?: unknown; remainingSeconds?: unknown };
          if (res.statusCode === 200 && typeof result.url === 'string' && result.url.startsWith('http://127.0.0.1:') && typeof result.expiresAt === 'number' && typeof result.remainingSeconds === 'number') resolveIssue({ url: result.url, expiresAt: result.expiresAt, remainingSeconds: result.remainingSeconds, started: false });
          else rejectIssue(new ConnectorError('service_unavailable', 'Management web session is unavailable.'));
        } catch { rejectIssue(new ConnectorError('service_unavailable', 'Management web returned an invalid response.')); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => rejectIssue(new ConnectorError('service_unavailable', 'Management web is not running.')));
    req.end();
  });
}

/** Start or reuse an isolated, fixed-TTL management web process. */
export async function openManagementWeb(onboardingId?: string): Promise<ManagementResult> {
  const paths = statePaths();
  await startService();
  const expiresAt = (() => { try { return Number.parseInt(readFileSync(paths.webExpiresAtFile, 'utf8').trim(), 10); } catch { return 0; } })();
  if (livePid(paths.webPidFile) && expiresAt > Date.now()) {
    try { return await issueManagementUrl(onboardingId); } catch { /* replace a broken web process */ }
  }
  for (const file of [paths.webPidFile, paths.adminUrlFile, paths.webExpiresAtFile]) try { rmSync(file, { force: true }); } catch { /* best effort */ }
  const entry = fileURLToPath(new URL('../admin/main.js', import.meta.url));
  const nextExpiry = Date.now() + 60 * 60_000;
  const child = spawn(process.execPath, [entry], { detached: true, stdio: 'ignore', env: { ...process.env, APPLE_CONNECTOR_WEB_EXPIRES_AT: String(nextExpiry) } });
  child.unref();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (livePid(paths.webPidFile)) {
      try { const issued = await issueManagementUrl(onboardingId); return { ...issued, started: true }; } catch { /* wait */ }
    }
    await sleep(50);
  }
  throw new ConnectorError('service_unavailable', 'Management web did not become ready.');
}

export async function createOnboarding(expiresAt = Date.now() + 60 * 60_000): Promise<{ onboardingId: string; expiresAt: number }> {
  const paths = statePaths();
  await startService();
  const created = await new HttpServiceClient(paths.socket).request('onboarding.create', { expiresAt }, readAdminToken(paths)) as { id: string; expiresAt: number };
  return { onboardingId: created.id, expiresAt: created.expiresAt };
}

export async function onboardingStatus(id: string): Promise<unknown> {
  const paths = statePaths();
  await startService();
  return new HttpServiceClient(paths.socket).request('onboarding.status', { id }, readAdminToken(paths));
}

/** Start or reuse the detached service, then prove both RPC and management site readiness. */
export async function startService(): Promise<StartResult> {
  const paths = statePaths();
  setup();
  const existing = status();
  if (existing.running && existing.pid !== null) {
    try {
      const info = await new HttpServiceClient(paths.socket).request('management.service_info', {}, readAdminToken(paths)) as { version?: unknown };
      if (info.version === appVersion) {
        return { started: false, pid: existing.pid };
      }
    } catch { /* An incompatible running service must be replaced by this build. */ }
    await stopService();
  }
  const entry = fileURLToPath(new URL('./main.js', import.meta.url));
  const child = spawn(process.execPath, [entry], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!existsSync(paths.socket)) { await sleep(100); continue; }
    const after = status();
    if (after.running && after.pid !== null) {
      try {
        await new HttpServiceClient(paths.socket).request('audit.summary', {}, readAdminToken(paths));
        return { started: true, pid: after.pid };
      } catch { await sleep(100); }
    }
  }
  let tail = '';
  try { tail = readFileSync(paths.logFile, 'utf8').split('\n').slice(-8).join('\n'); } catch { /* No log yet. */ }
  throw new ConnectorError('service_unavailable', `Service did not become ready.\n${tail}`.trim());
}

/** Replace any existing instance and run the service in this terminal process. */
export async function startForegroundService(): Promise<StartResult> {
  setup();
  const existing = status();
  if (existing.running) await stopService();
  // main owns the listeners and SIGINT/SIGTERM shutdown path. Dynamic import keeps the
  // development CLI itself as the service process instead of spawning or detaching a child.
  await import('./main.js');
  const current = status();
  if (!current.running || current.pid !== process.pid) throw new ConnectorError('service_unavailable', 'Foreground service did not become ready in the current process.');
  return { started: true, pid: process.pid };
}

/** Stop the background service and wait for its socket to disappear. */
export async function stopService(): Promise<void> {
  const paths = statePaths();
  const current = status();
  if (!current.running || current.pid === null) throw new ConnectorError('conflict', 'Service is not running.');
  try { process.kill(current.pid, 'SIGTERM'); } catch { throw new ConnectorError('service_unavailable', 'Cannot signal the service process.'); }
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!existsSync(paths.socket)) return;
    await sleep(100);
  }
  throw new ConnectorError('service_unavailable', 'Service did not stop within the timeout; check the process and state directory.');
}

/** Read the memory-only bootstrap URL created by the currently running local service. */
export function managementUrl(): string {
  const current = status();
  if (!current.running) throw new ConnectorError('service_unavailable', 'Service is not running. Run `apple-connector start`.');
  throw new ConnectorError('service_unavailable', 'Management URLs are temporary; run apple-connector open.');
}
