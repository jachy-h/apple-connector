import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { appVersion } from '../../application/version.js';
import { Store } from '../../storage/database.js';
import { ConnectorError } from '../../application/errors.js';
import { loadOrCreateAdminToken, statePaths } from './paths.js';
import type { StatePaths } from './paths.js';

export interface SetupResult { paths: StatePaths; adminToken?: string; adminTokenCreated: boolean; version: string }
export interface StatusResult {
  running: boolean; pid: number | null; version: string; paths: StatePaths;
  dbBytes: number | null; clients: number; operations: number; adminTokenFileExists: boolean;
}

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
  return { running, pid, version: appVersion, paths, dbBytes, clients, operations, adminTokenFileExists: existsSync(paths.adminTokenFile) };
}

/** Start the detached background service and wait for it to accept connections. */
export async function startService(): Promise<void> {
  const paths = statePaths();
  const existing = status();
  if (existing.running) throw new ConnectorError('conflict', `Service is already running (pid ${existing.pid}).`);
  if (!existing.adminTokenFileExists) throw new ConnectorError('service_unavailable', 'Run `apple-connector setup` first.');
  const entry = fileURLToPath(new URL('./main.js', import.meta.url));
  const child = spawn(process.execPath, [entry], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!existsSync(paths.socket)) { await sleep(100); continue; }
    const after = status();
    if (after.running) { console.log(`apple-connector service started (pid ${after.pid}).`); return; }
  }
  let tail = '';
  try { tail = readFileSync(paths.logFile, 'utf8').split('\n').slice(-8).join('\n'); } catch { /* No log yet. */ }
  throw new ConnectorError('service_unavailable', `Service did not become ready.\n${tail}`.trim());
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
  const paths = statePaths();
  const current = status();
  if (!current.running) throw new ConnectorError('service_unavailable', 'Service is not running. Run `apple-connector start`.');
  try {
    const url = readFileSync(paths.adminUrlFile, 'utf8').trim();
    if (!url.startsWith('http://127.0.0.1:')) throw new Error('Unexpected URL');
    return url;
  } catch { throw new ConnectorError('service_unavailable', 'Management link is unavailable; restart the service to issue a new link.'); }
}
