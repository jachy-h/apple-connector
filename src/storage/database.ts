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
    if (row.user_version > 2) {
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

  operationProvider(id: string): string {
    const row = this.db.prepare('SELECT provider FROM operations WHERE id=?').get(id) as { provider: string } | undefined;
    if (!row) throw new ConnectorError('permission_denied', 'Unknown or inaccessible plan.');
    return row.provider;
  }

  revoke(id: string): void {
    this.transaction(() => {
      this.client(id);
      this.db.prepare('UPDATE clients SET revoked=1, policy_version=policy_version+1 WHERE id=?').run(id);
      this.db.prepare("UPDATE operations SET state='cancelled',payload=NULL WHERE client_id=? AND state IN ('prepared','approved')").run(id);
      this.audit({ at: Date.now(), clientId: id, action: 'client_revoked', outcome: 'allowed', count: 0 });
    });
  }

  audit(input: AuditEvent): void {
    const event = auditEventSchema.parse(input);
    const json = JSON.stringify(event);
    this.db.prepare('INSERT INTO audit(at,event,bytes) VALUES(?,?,?)').run(event.at, json, Buffer.byteLength(json));
  }

  auditEvents(): AuditEvent[] {
    return this.db.prepare('SELECT event FROM audit ORDER BY id DESC LIMIT 1000').all()
      .map((row) => JSON.parse(row.event as string) as AuditEvent);
  }

  auditSummary(): { count: number; bytes: number } {
    const row = this.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM audit').get() as { count: number; bytes: number };
    return { count: row.count, bytes: row.bytes };
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
