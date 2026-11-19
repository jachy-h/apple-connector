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
    if (row.user_version > 8) {
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
    if (row.user_version <= 4) this.transaction(() => this.db.exec(`
      ALTER TABLE clients ADD COLUMN last_used_at INTEGER;
      PRAGMA user_version=5;
    `));
    if (row.user_version <= 5) this.transaction(() => {
      // Approval was removed in v0.14.0. Pending plans can no longer be approved; never
      // execute an intent that was left between prepare and commit during the upgrade.
      if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='operations'").get()) {
        this.db.prepare("UPDATE operations SET state='cancelled',payload=NULL WHERE state IN ('prepared','approved')").run();
      }
      const clients = this.db.prepare('SELECT id,grants FROM clients').all() as Array<{ id: string; grants: string }>;
      const update = this.db.prepare('UPDATE clients SET grants=? WHERE id=?');
      for (const client of clients) {
        let grants: unknown;
        try { grants = JSON.parse(client.grants); }
        catch { throw new ConnectorError('service_unavailable', 'Existing client grants are invalid JSON.'); }
        if (!Array.isArray(grants)) throw new ConnectorError('service_unavailable', 'Existing client grants are invalid.');
        const stripped = grants.map((grant) => {
          if (!grant || typeof grant !== 'object' || Array.isArray(grant)) return grant;
          const { approval: _approval, ...rest } = grant as Record<string, unknown>;
          return rest;
        });
        update.run(JSON.stringify(stripped), client.id);
      }
      this.db.exec('PRAGMA user_version=6');
    });
    if (row.user_version <= 6) this.transaction(() => this.db.exec(`
      DROP TABLE IF EXISTS onboarding;
      PRAGMA user_version=7;
    `));
    if (row.user_version <= 7) this.transaction(() => {
      // Synthetic or partially initialised databases may not have clients yet; adding the
      // binding columns must not turn an older file into an unopenable one.
      if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='clients'").get()) {
        this.db.exec('ALTER TABLE clients ADD COLUMN agent_name TEXT; ALTER TABLE clients ADD COLUMN verified_at INTEGER;');
      }
      this.db.exec('PRAGMA user_version=8');
    });
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

  authenticate(token: string, now = Date.now()): Client {
    if (typeof token !== 'string' || token.length < 32 || token.length > 128) {
      throw new ConnectorError('permission_denied', 'Invalid client credentials.');
    }
    const row = this.db.prepare('SELECT id FROM clients WHERE token_hash=? AND revoked=0').get(digest(token)) as { id: string } | undefined;
    if (!row) throw new ConnectorError('permission_denied', 'Invalid client credentials.');
    // Keep the display value fresh without turning every agent request into a write transaction.
    this.db.prepare('UPDATE clients SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at < ?)')
      .run(now, row.id, now - 60_000);
    return this.client(row.id);
  }

  client(id: string): Client {
    const row = this.db.prepare('SELECT id,name,grants,policy_version,revoked,last_used_at,agent_name,verified_at FROM clients WHERE id=?').get(id) as
      { id: string; name: string; grants: string; policy_version: number; revoked: number; last_used_at: number | null; agent_name: string | null; verified_at: number | null } | undefined;
    if (!row) throw new ConnectorError('permission_denied', 'Unknown client.');
    return { id: row.id, name: row.name, grants: JSON.parse(row.grants), policyVersion: row.policy_version, revoked: Boolean(row.revoked), lastUsedAt: row.last_used_at, agentName: row.agent_name, verifiedAt: row.verified_at };
  }

  listClients(): Client[] {
    return (this.db.prepare('SELECT id,name,grants,policy_version,revoked,last_used_at,agent_name,verified_at FROM clients ORDER BY id').all() as Array<{
      id: string; name: string; grants: string; policy_version: number; revoked: number; last_used_at: number | null; agent_name: string | null; verified_at: number | null; }>)
      .map((row) => ({ id: row.id, name: row.name, grants: JSON.parse(row.grants) as Client['grants'], policyVersion: row.policy_version, revoked: Boolean(row.revoked), lastUsedAt: row.last_used_at, agentName: row.agent_name, verifiedAt: row.verified_at }));
  }

  /** Record which Agent completed verification for this authorization. Latest verification wins. */
  verifyClient(id: string, agentName: string, now = Date.now()): Client {
    const changed = this.db.prepare('UPDATE clients SET agent_name=?, verified_at=? WHERE id=? AND revoked=0').run(agentName, now, id);
    if (Number(changed.changes) === 0) throw new ConnectorError('permission_denied', 'Unknown client.');
    return this.client(id);
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

  /** Permanently remove an authorization; audit events remain as immutable history. */
  deleteClient(id: string): { id: string } {
    this.transaction(() => {
      const name = this.client(id).name;
      const unresolved = this.db.prepare("SELECT COUNT(*) AS count FROM operations WHERE client_id=? AND state='executing'").get(id) as { count: number };
      if (unresolved.count > 0) throw new ConnectorError('conflict', 'A write is still executing for this client; wait for it to finish before deleting.');
      this.db.prepare('DELETE FROM operations WHERE client_id=?').run(id);
      this.db.prepare('DELETE FROM clients WHERE id=?').run(id);
      this.audit({ at: Date.now(), clientId: id, clientName: name, action: 'client_deleted', outcome: 'allowed', count: 0 });
    });
    return { id };
  }

  audit(input: Omit<AuditEvent, 'source'> & { source?: 'client' | 'web' }): void {
    // Keep a display name with the event so deleted authorizations remain identifiable
    // in history. Old rows without it still parse because the field is optional.
    const named = input.clientName === undefined && input.clientId
      ? (() => { const name = this.clientName(input.clientId!); return name === undefined ? input : { ...input, clientName: name }; })()
      : input;
    const event = auditEventSchema.parse(named);
    const json = JSON.stringify(event);
    this.db.prepare('INSERT INTO audit(at,event,bytes) VALUES(?,?,?)').run(event.at, json, Buffer.byteLength(json));
  }

  private clientName(id: string): string | undefined {
    const row = this.db.prepare('SELECT name FROM clients WHERE id=?').get(id) as { name: string } | undefined;
    return row?.name;
  }

  /** Delete every audit event for one chart lane. Returns the number of removed rows. */
  deleteAuditLane(ref: { kind: 'client'; clientId: string } | { kind: 'web' }): { deleted: number } {
    return this.transaction(() => {
      const rows = this.db.prepare('SELECT id,event FROM audit').all() as Array<{ id: number; event: string }>;
      const ids: number[] = [];
      for (const row of rows) {
        let event: AuditEvent;
        try { event = JSON.parse(row.event) as AuditEvent; } catch { continue; }
        if (ref.kind === 'web' ? event.source === 'web' : event.clientId === ref.clientId) ids.push(row.id);
      }
      const remove = this.db.prepare('DELETE FROM audit WHERE id=?');
      for (const id of ids) remove.run(id);
      return { deleted: ids.length };
    });
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
