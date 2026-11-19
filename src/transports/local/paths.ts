import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ConnectorError } from '../../application/errors.js';

export interface StatePaths {
  dir: string;
  db: string;
  adminTokenFile: string;
  socket: string;
  pidFile: string;
  serviceLock: string;
  adminUrlFile: string;
  webPidFile: string;
  webExpiresAtFile: string;
  helperSocket: string;
  helperPidFile: string;
  helperLogFile: string;
  logFile: string;
}

export interface StateMigration {
  migrated: boolean;
  from: string;
  to: string;
  stoppedService: boolean;
  stoppedWeb: boolean;
}

const TOKEN_BYTES = 32;
const LEGACY_STATE_DIR_NAME = 'apple-connector';
const STATE_DIR_NAME = '.apple-connector';
const RUNTIME_FILES = ['service.sock', 'service.pid', 'service.lock', 'admin-url', 'web.pid', 'web-expires-at', 'helper.sock', 'helper.pid', 'helper.log'];

export function defaultStateDir(): string {
  return join(homedir(), STATE_DIR_NAME);
}

export function legacyStateDir(): string {
  return join(homedir(), LEGACY_STATE_DIR_NAME);
}

function statePathsFor(base: string): StatePaths {
  if (['/', process.env.HOME].includes(base)) {
    throw new ConnectorError('invalid_request', 'State directory must be a dedicated directory, not the home directory.');
  }
  return {
    dir: base,
    db: join(base, 'db.sqlite3'),
    adminTokenFile: join(base, 'admin-token'),
    socket: join(base, 'service.sock'),
    pidFile: join(base, 'service.pid'),
    serviceLock: join(base, 'service.lock'),
    adminUrlFile: join(base, 'admin-url'),
    webPidFile: join(base, 'web.pid'),
    webExpiresAtFile: join(base, 'web-expires-at'),
    helperSocket: join(base, 'helper.sock'),
    helperPidFile: join(base, 'helper.pid'),
    helperLogFile: join(base, 'helper.log'),
    logFile: join(base, 'service.log'),
  };
}

/** State (including the audit SQLite database) lives under a dedicated user directory; tests may override it. */
export function statePaths(): StatePaths {
  const base = process.env.APPLE_CONNECTOR_STATE_DIR
    ? resolve(process.env.APPLE_CONNECTOR_STATE_DIR)
    : defaultStateDir();
  return statePathsFor(base);
}

function livePid(file: string): number | null {
  let pid: number;
  try { pid = Number.parseInt(readFileSync(file, 'utf8').trim(), 10); }
  catch { return null; }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return pid; }
  catch { return null; }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  return predicate();
}

/** Move a state directory when no service is using it. Refuses to merge two non-empty directories. */
export function migrateStateDirectory(from: string, to: string, options: { allowStaleRuntime?: boolean } = {}): StateMigration {
  const result: StateMigration = { migrated: false, from, to, stoppedService: false, stoppedWeb: false };
  if (!existsSync(from)) return result;
  if (existsSync(to)) {
    let entries: string[];
    try { entries = readdirSync(to); }
    catch { throw new ConnectorError('service_unavailable', 'Cannot inspect the new state directory.'); }
    if (entries.length) throw new ConnectorError('conflict', `Both state directories exist; refusing to merge them: ${from} and ${to}`);
    rmdirSync(to);
  }
  const pid = livePid(join(from, 'service.pid'));
  if (pid !== null) {
    throw new ConnectorError('service_unavailable', `The legacy service is still running (pid ${pid}). Run \`apple-connector migrate-state\` to stop it and migrate.`);
  }
  if (!options.allowStaleRuntime && existsSync(join(from, 'service.sock'))) {
    throw new ConnectorError('service_unavailable', 'The legacy service socket still exists. Stop the legacy service before migrating.');
  }
  // Runtime files cannot be reused across the rename; they are recreated by the new service.
  for (const file of RUNTIME_FILES) {
    try { rmSync(join(from, file), { force: true }); } catch { /* Best effort. */ }
  }
  renameSync(from, to);
  chmodSync(to, 0o700);
  return { ...result, migrated: true };
}

/** Automatic migration path: only runs when no legacy service owns the directory. */
export function migrateLegacyStateSync(): StateMigration {
  if (process.env.APPLE_CONNECTOR_STATE_DIR) {
    return { migrated: false, from: legacyStateDir(), to: defaultStateDir(), stoppedService: false, stoppedWeb: false };
  }
  return migrateStateDirectory(legacyStateDir(), defaultStateDir());
}

/** Explicit migration path: gracefully stop the legacy service and web process, then move the directory. */
export async function migrateStateDirectoryWithStop(from: string, to: string): Promise<StateMigration> {
  const result: StateMigration = { migrated: false, from, to, stoppedService: false, stoppedWeb: false };
  if (!existsSync(from)) return result;
  const servicePid = livePid(join(from, 'service.pid'));
  if (servicePid !== null) {
    try { process.kill(servicePid, 'SIGTERM'); }
    catch { throw new ConnectorError('service_unavailable', `Cannot signal the legacy service (pid ${servicePid}).`); }
    result.stoppedService = true;
    const stopped = await waitFor(() => livePid(join(from, 'service.pid')) === null, 10_000);
    if (!stopped) throw new ConnectorError('service_unavailable', 'The legacy service did not stop within 10 seconds; nothing was moved.');
  }
  const webPid = livePid(join(from, 'web.pid'));
  if (webPid !== null) {
    try { process.kill(webPid, 'SIGTERM'); result.stoppedWeb = true; } catch { /* Best effort. */ }
    await waitFor(() => livePid(join(from, 'web.pid')) === null, 2_000);
  }
  const migrated = migrateStateDirectory(from, to, { allowStaleRuntime: true });
  return { ...migrated, stoppedService: result.stoppedService, stoppedWeb: result.stoppedWeb };
}

/** Explicit migration path for the default home directories. */
export async function migrateLegacyStateWithStop(): Promise<StateMigration> {
  if (process.env.APPLE_CONNECTOR_STATE_DIR) {
    throw new ConnectorError('invalid_request', 'Cannot migrate while APPLE_CONNECTOR_STATE_DIR is set.');
  }
  return migrateStateDirectoryWithStop(legacyStateDir(), defaultStateDir());
}

export function ensureStateDir(paths: StatePaths): void {
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  chmodSync(paths.dir, 0o700);
}

export function readAdminToken(paths: StatePaths): string {
  if (!existsSync(paths.adminTokenFile)) {
    throw new ConnectorError('service_unavailable', 'Run `apple-connector start` first.');
  }
  // Matches the legacy format and current 0600-protected file.
  return readFileSync(paths.adminTokenFile, 'utf8').trim();
}

export function loadOrCreateAdminToken(paths: StatePaths): string {
  ensureStateDir(paths);
  if (existsSync(paths.adminTokenFile)) return readAdminToken(paths);
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  writeFileSync(paths.adminTokenFile, `${token}\n`, { mode: 0o600 });
  chmodSync(paths.adminTokenFile, 0o600);
  return token;
}

/** Store an agent credential outside configuration and command-line arguments. */
export function writeClientToken(file: string, token: string): void {
  if (!token || /\s/.test(token)) throw new ConnectorError('invalid_request', 'Client credential is invalid.');
  writeFileSync(file, `${token}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(file, 0o600);
}

const CLIENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Resolve an agent-facing authorization key to its owner-only token file under `profiles/`. */
export function clientTokenFile(paths: StatePaths, key: string): string {
  if (!CLIENT_KEY_PATTERN.test(key)) throw new ConnectorError('invalid_request', 'Authorization key is invalid.');
  return join(paths.dir, 'profiles', `${key}.token`);
}

/** Read an agent credential by key without returning the resolved file path to the caller. */
export function readClientTokenByKey(paths: StatePaths, key: string): string {
  const file = clientTokenFile(paths, key);
  if (!existsSync(file)) {
    throw new ConnectorError('invalid_request', 'Unknown authorization key. Run `apple-connector open` to create or recover an authorization.');
  }
  return readClientToken(file);
}

/** Read only a regular, owner-private credential file. */
export function readClientToken(file: string): string {
  let stat: ReturnType<typeof lstatSync>;
  try { stat = lstatSync(file); } catch { throw new ConnectorError('invalid_request', 'Agent credential file does not exist.'); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new ConnectorError('invalid_request', 'Agent credential file must be a regular file.');
  if ((stat.mode & 0o077) !== 0) throw new ConnectorError('permission_denied', 'Agent credential file must not be accessible by group or other users.');
  const token = readFileSync(file, 'utf8').trim();
  if (!token || /\s/.test(token)) throw new ConnectorError('invalid_request', 'Agent credential file is invalid.');
  return token;
}

export function safeEqualToken(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Claim service ownership before a socket can be removed or bound. `open(..., wx)` is atomic,
 * unlike a pid/socket existence check, so two simultaneous `start` commands cannot evict each
 * other. A lock left by a dead process is recovered after its pid is checked.
 */
export function acquireServiceLock(paths: StatePaths): void {
  ensureStateDir(paths);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(paths.serviceLock, 'wx', 0o600);
      try { writeFileSync(fd, `${process.pid}\n`); } finally { closeSync(fd); }
      chmodSync(paths.serviceLock, 0o600);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let owner: number | undefined;
      try { owner = Number.parseInt(readFileSync(paths.serviceLock, 'utf8').trim(), 10); } catch { /* Broken lock is stale. */ }
      if (owner && Number.isInteger(owner)) {
        try { process.kill(owner, 0); throw new ConnectorError('conflict', `Service is already running (pid ${owner}).`); }
        catch (cause) { if (cause instanceof ConnectorError) throw cause; }
      }
      try { rmSync(paths.serviceLock, { force: true }); } catch { /* Retry once; another owner may have won. */ }
    }
  }
  throw new ConnectorError('conflict', 'Service startup is already in progress.');
}

export function releaseServiceLock(paths: StatePaths): void {
  try { rmSync(paths.serviceLock, { force: true }); } catch { /* Best effort during shutdown. */ }
}
