import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { ConnectorError } from '../application/errors.js';
import { clientInputSchema } from '../policy/schema.js';
import type { Client } from '../policy/schema.js';
import { auditEventSchema, defaultRetention } from '../audit/schema.js';
import type { AuditEvent } from '../audit/schema.js';

export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') {
      // Callers provide a dedicated state directory, never the user's home directory itself.
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      chmodSync(dirname(path), 0o700);
    }
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA auto_vacuum=INCREMENTAL; PRAGMA journal_mode=WAL;');
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (row.user_version > 4) {
      this.db.close();
      throw new ConnectorError('service_unavailable', 'Database was created by a newer version.');
    }
    if (row.user_version === 0) this.transaction(() => this.db.exec(`
      CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
        grants TEXT NOT NULL, policy_version INTEGER NOT NULL DEFAULT 1, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE audit (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, event TEXT NOT NULL, bytes INTEGER NOT NULL);
      CREATE INDEX audit_at ON audit(at);
      CREATE TABLE operations (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), provider TEXT NOT NULL,
        key_hash TEXT NOT NULL, request_hash TEXT NOT NULL, policy_version INTEGER NOT NULL,
        state TEXT NOT NULL, payload TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
        result TEXT, UNIQUE(client_id, key_hash));
      PRAGMA user_version=2;
    `));
    if (row.user_version === 1) this.transaction(() => this.db.exec(`
      ALTER TABLE operations ADD COLUMN provider TEXT NOT NULL DEFAULT 'reminders';
      PRAGMA user_version=2;
    `));
    if (row.user_version <= 2) this.transaction(() => this.db.exec(`
      CREATE TABLE web_operations (id TEXT PRIMARY KEY, provider TEXT NOT NULL,
        key_hash TEXT UNIQUE NOT NULL, request_hash TEXT NOT NULL, state TEXT NOT NULL,
        payload TEXT, result TEXT, created_at INTEGER NOT NULL);
      CREATE INDEX web_operations_created_at ON web_operations(created_at DESC);
      PRAGMA user_version=3;
    `));
    if (row.user_version <= 3) this.transaction(() => this.db.exec(`
      CREATE TABLE onboarding (id TEXT PRIMARY KEY, state TEXT NOT NULL, expires_at INTEGER NOT NULL,
        client_id TEXT REFERENCES clients(id), credential_file TEXT, failure_code TEXT, created_at INTEGER NOT NULL);
      CREATE INDEX onboarding_expires_at ON onboarding(expires_at);
      PRAGMA user_version=4;
    `));
  }

  createOnboarding(expiresAt: number): { id: string; expiresAt: number; state: 'pending' } {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new ConnectorError('invalid_request', 'Onboarding expiry must be in the future.');
    const id = randomUUID();
    this.transaction(() => this.db.prepare('INSERT INTO onboarding(id,state,expires_at,created_at) VALUES(?,?,?,?)').run(id, 'pending', expiresAt, Date.now()));
    return { id, expiresAt, state: 'pending' };
  }

  onboarding(id: string): { id: string; state: 'pending' | 'configured' | 'expired' | 'failed'; expiresAt: number; clientId?: string; credentialFile?: string; failureCode?: string } {
    const row = this.db.prepare('SELECT id,state,expires_at,client_id,credential_file,failure_code FROM onboarding WHERE id=?').get(id) as { id: string; state: string; expires_at: number; client_id: string | null; credential_file: string | null; failure_code: string | null } | undefined;
    if (!row) throw new ConnectorError('invalid_request', 'Unknown onboarding ID.');
    if (row.state === 'pending' && row.expires_at <= Date.now()) {
      this.db.prepare("UPDATE onboarding SET state='expired' WHERE id=? AND state='pending'").run(id);
      return { id: row.id, state: 'expired', expiresAt: row.expires_at };
    }
    if (!['pending', 'configured', 'expired', 'failed'].includes(row.state)) throw new ConnectorError('service_unavailable', 'Invalid onboarding state.');
    return { id: row.id, state: row.state as 'pending' | 'configured' | 'expired' | 'failed', expiresAt: row.expires_at,
      ...(row.client_id ? { clientId: row.client_id } : {}), ...(row.credential_file ? { credentialFile: row.credential_file } : {}), ...(row.failure_code ? { failureCode: row.failure_code } : {}) };
  }

  completeOnboarding(id: string, clientId: string, credentialFile: string): void {
    const current = this.onboarding(id);
    if (current.state === 'configured') {
      if (current.clientId === clientId && current.credentialFile === credentialFile) return;
      throw new ConnectorError('conflict', 'This onboarding has already configured a profile.');
    }
    if (current.state !== 'pending') throw new ConnectorError('conflict', `This onboarding is ${current.state}.`);
    this.client(clientId);
    this.transaction(() => this.db.prepare("UPDATE onboarding SET state='configured',client_id=?,credential_file=? WHERE id=? AND state='pending'").run(clientId, credentialFile, id));
  }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  createClient(input: unknown): { client: Client; token: string } {
    const parsed = clientInputSchema.parse(input);
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    this.transaction(() => {
      this.db.prepare('INSERT INTO clients(id,name,token_hash,grants) VALUES(?,?,?,?)')
        .run(id, parsed.name, digest(token), JSON.stringify(parsed.grants));
      this.audit({ at: Date.now(), clientId: id, action: 'client_created', outcome: 'allowed', count: 0 });
    });
    return { client: this.client(id), token };
  }

  updateClient(id: string, input: unknown): Client {
    const current = this.client(id);
    if (current.revoked) throw new ConnectorError('conflict', 'Revoked clients cannot be edited.');
    const parsed = clientInputSchema.parse(input);
    this.transaction(() => {
      this.db.prepare('UPDATE clients SET name=?,grants=?,policy_version=policy_version+1 WHERE id=? AND revoked=0')
        .run(parsed.name, JSON.stringify(parsed.grants), id);
      // Every policy change invalidates executable plans; the next prepare binds the new version.
      this.db.prepare("UPDATE operations SET state='cancelled',payload=NULL WHERE client_id=? AND state IN ('prepared','approved')").run(id);
      this.audit({ at: Date.now(), clientId: id, action: 'client_updated', outcome: 'allowed', count: 0 });
    });
    return this.client(id);
  }

  rotateClientToken(id: string): { client: Client; token: string } {
    const current = this.client(id);
    if (current.revoked) throw new ConnectorError('conflict', 'Revoked clients cannot rotate credentials.');
    const token = randomBytes(32).toString('base64url');
    this.transaction(() => {
      this.db.prepare('UPDATE clients SET token_hash=? WHERE id=? AND revoked=0').run(digest(token), id);
      this.audit({ at: Date.now(), clientId: id, action: 'client_token_rotated', outcome: 'allowed', count: 0 });
    });
    return { client: this.client(id), token };
  }

  authenticate(token: string): Client {
    if (typeof token !== 'string' || token.length < 32 || token.length > 128) {
      throw new ConnectorError('permission_denied', 'Invalid client credentials.');
    }
    const row = this.db.prepare('SELECT id FROM clients WHERE token_hash=? AND revoked=0').get(digest(token)) as { id: string } | undefined;
    if (!row) throw new ConnectorError('permission_denied', 'Invalid client credentials.');
    return this.client(row.id);
  }

  client(id: string): Client {
    const row = this.db.prepare('SELECT id,name,grants,policy_version,revoked FROM clients WHERE id=?').get(id) as
      { id: string; name: string; grants: string; policy_version: number; revoked: number } | undefined;
    if (!row) throw new ConnectorError('permission_denied', 'Unknown client.');
    return { id: row.id, name: row.name, grants: JSON.parse(row.grants), policyVersion: row.policy_version, revoked: Boolean(row.revoked) };
  }

  listClients(): Client[] {
    return (this.db.prepare('SELECT id,name,grants,policy_version,revoked FROM clients ORDER BY id').all() as Array<{
      id: string; name: string; grants: string; policy_version: number; revoked: number; }>)
      .map((row) => ({ id: row.id, name: row.name, grants: JSON.parse(row.grants) as Client['grants'], policyVersion: row.policy_version, revoked: Boolean(row.revoked) }));
  }

  /** Operation metadata for the admin surface. Staged payload may contain private content and is never returned here. */
  listOperations(): Array<{
    id: string; clientId: string; provider: string; state: string; keyHash: string; requestHash: string;
    policyVersion: number; expiresAt: number; createdAt: number; result: string | null; }> {
    return (this.db.prepare('SELECT id,client_id,provider,key_hash,request_hash,policy_version,state,expires_at,created_at,result FROM operations ORDER BY created_at DESC LIMIT 100').all() as unknown[]).map((row) => {
      const r = row as {
        id: string; client_id: string; provider: string; key_hash: string; request_hash: string; policy_version: number;
        state: string; expires_at: number; created_at: number; result: string | null; };
      return { id: r.id, clientId: r.client_id, provider: r.provider, state: r.state, keyHash: r.key_hash, requestHash: r.request_hash,
        policyVersion: r.policy_version, expiresAt: r.expires_at, createdAt: r.created_at, result: r.result };
    });
  }

  queryOperations(input: { offset?: number | undefined; limit?: number | undefined; provider?: string | undefined; clientId?: string | undefined; state?: string | undefined } = {}): { items: ReturnType<Store['listOperations']>; total: number; offset: number; limit: number } {
    const offset = input.offset ?? 0; const limit = input.limit ?? 50;
    const clauses: string[] = []; const values: (string | number)[] = [];
    if (input.provider) { clauses.push('provider=?'); values.push(input.provider); }
    if (input.clientId) { clauses.push('client_id=?'); values.push(input.clientId); }
    if (input.state) { clauses.push('state=?'); values.push(input.state); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS count FROM operations${where}`).get(...values) as { count: number }).count;
    const rows = this.db.prepare(`SELECT id,client_id,provider,key_hash,request_hash,policy_version,state,expires_at,created_at,result FROM operations${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...values, limit, offset) as unknown[];
    const items = rows.map((row) => {
      const r = row as { id: string; client_id: string; provider: string; key_hash: string; request_hash: string; policy_version: number; state: string; expires_at: number; created_at: number; result: string | null; };
      return { id: r.id, clientId: r.client_id, provider: r.provider, state: r.state, keyHash: r.key_hash, requestHash: r.request_hash, policyVersion: r.policy_version, expiresAt: r.expires_at, createdAt: r.created_at, result: r.result };
    });
    return { items, total, offset, limit };
  }

  operationProvider(id: string): string {
    const row = this.db.prepare('SELECT provider FROM operations WHERE id=?').get(id) as { provider: string } | undefined;
    if (!row) throw new ConnectorError('permission_denied', 'Unknown or inaccessible plan.');
    return row.provider;
  }

  /** Content is available only while a plan is executable and only to the trusted management session. */
  operationPreview(id: string): { id: string; clientId: string; provider: string; state: string; expiresAt: number; change: unknown } {
    const row = this.db.prepare('SELECT id,client_id,provider,state,expires_at,payload FROM operations WHERE id=?').get(id) as { id: string; client_id: string; provider: string; state: string; expires_at: number; payload: string | null } | undefined;
    if (!row) throw new ConnectorError('permission_denied', 'Unknown operation.');
    if (!['prepared', 'approved'].includes(row.state) || !row.payload) throw new ConnectorError('conflict', 'The plan content is no longer available for preview.');
    let change: unknown;
    try { change = JSON.parse(row.payload); } catch { throw new ConnectorError('service_unavailable', 'Stored plan content is invalid.'); }
    return { id: row.id, clientId: row.client_id, provider: row.provider, state: row.state, expiresAt: row.expires_at, change };
  }

  revoke(id: string): void {
    this.transaction(() => {
      this.client(id);
      this.db.prepare('UPDATE clients SET revoked=1, policy_version=policy_version+1 WHERE id=?').run(id);
      this.db.prepare("UPDATE operations SET state='cancelled',payload=NULL WHERE client_id=? AND state IN ('prepared','approved')").run(id);
      this.audit({ at: Date.now(), clientId: id, action: 'client_revoked', outcome: 'allowed', count: 0 });
    });
  }

  /** Reject only a not-yet-approved immutable plan; no native call is attempted. */
  rejectOperation(id: string): void {
    this.transaction(() => {
      const operation = this.db.prepare('SELECT client_id,state FROM operations WHERE id=?').get(id) as { client_id: string; state: string } | undefined;
      if (!operation) throw new ConnectorError('permission_denied', 'Unknown operation.');
      if (operation.state !== 'prepared') throw new ConnectorError('conflict', `Only prepared operations can be rejected (current state: ${operation.state}).`);
      this.db.prepare("UPDATE operations SET state='cancelled',payload=NULL WHERE id=? AND state='prepared'").run(id);
      this.audit({ at: Date.now(), clientId: operation.client_id, operationId: id, action: 'operation_rejected', outcome: 'denied', count: 0 });
    });
  }

  audit(input: Omit<AuditEvent, 'source'> & { source?: 'client' | 'web' }): void {
    const event = auditEventSchema.parse(input);
    const json = JSON.stringify(event);
    this.db.prepare('INSERT INTO audit(at,event,bytes) VALUES(?,?,?)').run(event.at, json, Buffer.byteLength(json));
  }

  auditEvents(): AuditEvent[] {
    return this.db.prepare('SELECT event FROM audit ORDER BY id DESC LIMIT 1000').all()
      .map((row) => JSON.parse(row.event as string) as AuditEvent);
  }

  queryAudit(input: { offset?: number | undefined; limit?: number | undefined; provider?: string | undefined; clientId?: string | undefined; source?: 'client' | 'web' | undefined; outcome?: string | undefined; from?: number | undefined; to?: number | undefined } = {}): { items: AuditEvent[]; total: number; offset: number; limit: number } {
    const offset = input.offset ?? 0; const limit = input.limit ?? 50;
    const filtered = (this.db.prepare('SELECT event FROM audit ORDER BY id DESC').all() as Array<{ event: string }>).map((row) => JSON.parse(row.event) as AuditEvent)
      .filter((event) => (!input.provider || event.provider === input.provider) && (!input.clientId || event.clientId === input.clientId) && (!input.source || event.source === input.source) && (!input.outcome || event.outcome === input.outcome) && (input.from === undefined || event.at >= input.from) && (input.to === undefined || event.at <= input.to));
    return { items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit };
  }

  auditSummary(): { count: number; bytes: number } {
    const row = this.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM audit').get() as { count: number; bytes: number };
    return { count: row.count, bytes: row.bytes };
  }

  diagnostics(): {
    operationsByState: Record<string, number>;
    pageSize: number;
    pageCount: number;
    freePages: number;
    recentErrors: Array<Pick<AuditEvent, 'at' | 'provider' | 'action' | 'errorCode'>>;
  } {
    const states = this.db.prepare('SELECT state,COUNT(*) AS count FROM operations GROUP BY state').all() as Array<{ state: string; count: number }>;
    const pageSize = (this.db.prepare('PRAGMA page_size').get() as { page_size: number }).page_size;
    const pageCount = (this.db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count;
    const freePages = (this.db.prepare('PRAGMA freelist_count').get() as { freelist_count: number }).freelist_count;
    const recentErrors = this.auditEvents().filter((event) => event.errorCode).slice(0, 10)
      .map((event) => ({ at: event.at, ...(event.provider ? { provider: event.provider } : {}), action: event.action,
        ...(event.errorCode ? { errorCode: event.errorCode } : {}) }));
    return { operationsByState: Object.fromEntries(states.map((row) => [row.state, row.count])), pageSize, pageCount, freePages, recentErrors };
  }

  /** Explicit user-management action. No replacement audit row is written because the request is to clear it. */
  clearAudit(): void {
    this.transaction(() => this.db.prepare('DELETE FROM audit').run());
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA incremental_vacuum(256);');
  }

  pruneOperations(now = Date.now()): void {
    this.transaction(() => {
      this.db.prepare("UPDATE operations SET state='expired',payload=NULL WHERE state IN ('prepared','approved') AND expires_at<=?").run(now);
      // Unknown/executing outcomes are deliberately never age-pruned.
      this.db.prepare("DELETE FROM operations WHERE state IN ('succeeded','failed','cancelled','expired') AND created_at<?")
        .run(now - 30 * 86_400_000);
    });
  }

  assertOperationCapacity(additionalBytes: number): void {
    const row = this.db.prepare(`SELECT COUNT(*) AS count,
      COALESCE(SUM(LENGTH(CAST(payload AS BLOB))),0) AS bytes FROM operations
      WHERE state IN ('prepared','approved','executing','outcome_unknown')`).get() as { count: number; bytes: number };
    if (row.count >= 1000 || row.bytes + additionalBytes > 8 * 1024 * 1024) {
      throw new ConnectorError('service_unavailable', 'Pending operation budget reached; resolve pending operations first.');
    }
  }

  pruneAudit(now = Date.now(), retention = defaultRetention): void {
    if (![retention.days, retention.maxRows, retention.maxBytes].every((value) => Number.isFinite(value) && value > 0)) {
      throw new ConnectorError('invalid_request', 'Retention limits must be positive.');
    }
    this.transaction(() => {
      this.db.prepare('DELETE FROM audit WHERE at<?').run(now - retention.days * 86_400_000);
      // Newest rows within BOTH budgets survive. Operations and credentials are separate tables.
      this.db.prepare(`DELETE FROM audit WHERE id IN (
        SELECT id FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id DESC) AS n,
          SUM(bytes) OVER (ORDER BY id DESC) AS used FROM audit)
        WHERE n>? OR used>?)`).run(retention.maxRows, retention.maxBytes);
    });
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA incremental_vacuum(256);');
  }

  close(): void { this.db.close(); }
}
