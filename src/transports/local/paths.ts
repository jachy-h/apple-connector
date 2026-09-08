import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  logFile: string;
}

const TOKEN_BYTES = 32;

/** State (including the audit SQLite database) lives under a dedicated user directory; tests may override it. */
export function statePaths(): StatePaths {
  const base = process.env.APPLE_CONNECTOR_STATE_DIR
    ? resolve(process.env.APPLE_CONNECTOR_STATE_DIR)
    : join(homedir(), 'apple-connector');
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
    logFile: join(base, 'service.log'),
  };
}

export function ensureStateDir(paths: StatePaths): void {
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  chmodSync(paths.dir, 0o700);
}

export function readAdminToken(paths: StatePaths): string {
  if (!existsSync(paths.adminTokenFile)) {
    throw new ConnectorError('service_unavailable', 'Run `apple-connector setup` first.');
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

/** Store an agent credential outside MCP configuration and command-line arguments. */
export function writeClientToken(file: string, token: string): void {
  if (!token || /\s/.test(token)) throw new ConnectorError('invalid_request', 'Client credential is invalid.');
  writeFileSync(file, `${token}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(file, 0o600);
}

/** Read only a regular, owner-private credential file. */
export function readClientToken(file: string): string {
  let stat: ReturnType<typeof lstatSync>;
  try { stat = lstatSync(file); } catch { throw new ConnectorError('invalid_request', 'MCP credential file does not exist.'); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new ConnectorError('invalid_request', 'MCP credential file must be a regular file.');
  if ((stat.mode & 0o077) !== 0) throw new ConnectorError('permission_denied', 'MCP credential file must not be accessible by group or other users.');
  const token = readFileSync(file, 'utf8').trim();
  if (!token || /\s/.test(token)) throw new ConnectorError('invalid_request', 'MCP credential file is invalid.');
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
