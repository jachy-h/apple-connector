import { ConnectorError } from './errors.js';
import { Store, digest } from '../storage/database.js';
import { createReminderSchema, reminderReceiptSchema } from '../providers/reminders/types.js';
import type { ReminderWriter } from '../providers/reminders/types.js';

type Provider = 'reminders';
type Row = { id: string; provider: Provider; request_hash: string; state: string; result: string | null };

/**
 * Durable, management-session write path. It has no client identity and never replays an
 * uncertain native mutation. Content is retained only while an operation is executing.
 */
export class WebWrites {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  // The third parameter is retained only to keep existing callers source-compatible; Notes
  // mutations are intentionally ignored in v0.5.0.
  constructor(private readonly store: Store, private readonly reminders: ReminderWriter, ignored?: unknown, now: () => number = Date.now) {
    this.now = typeof ignored === 'function' ? ignored as () => number : now;
    store.db.prepare("UPDATE web_operations SET state='outcome_unknown',payload=NULL WHERE state='executing'").run();
  }

  submitReminders(key: string, raw: unknown) { return this.queue(() => this.submit('reminders', key, createReminderSchema.parse(raw), this.reminders, reminderReceiptSchema)); }
  get(id: string) { return this.result(this.row(id)); }

  private queue<T>(work: () => Promise<T>): Promise<T> { const next = this.tail.then(work); this.tail = next.catch(() => undefined); return next; }
  private row(id: string): Row {
    const row = this.store.db.prepare('SELECT id,provider,request_hash,state,result FROM web_operations WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new ConnectorError('permission_denied', 'Unknown Web operation.');
    return row;
  }
  private result(row: Row) { return { id: row.id, provider: row.provider, state: row.state, result: row.result ? JSON.parse(row.result) : null }; }
  private async submit<T extends { containerId: string }>(provider: Provider, key: string, change: T, writer: { preflight(input: T): Promise<void>; create(input: T): Promise<unknown>; verify(receipt: unknown, expected: T): Promise<boolean> }, receiptSchema: { parse(value: unknown): { containerId: string } }) {
    const startedAt = this.now();
    const keyHash = digest(key); const requestHash = digest(JSON.stringify(change));
    const existing = this.store.db.prepare('SELECT id,provider,request_hash,state,result FROM web_operations WHERE key_hash=?').get(keyHash) as Row | undefined;
    if (existing) {
      if (existing.provider !== provider || existing.request_hash !== requestHash) throw new ConnectorError('conflict', 'Idempotency key was used for different content.');
      return this.result(existing);
    }
    try { await writer.preflight(change); }
    catch (error) {
      this.store.audit({ at: this.now(), source: 'web', operationId: key, provider, action: 'create', outcome: 'failed', count: 0, target: change.containerId, durationMs: this.now() - startedAt, errorCode: 'service_unavailable' });
      throw error;
    }
    // The browser generates this UUID before submission, so it can recover status after a
    // refresh or a lost response without ever resending a native mutation.
    const id = key;
    try { this.store.db.prepare('INSERT INTO web_operations(id,provider,key_hash,request_hash,state,payload,created_at) VALUES(?,?,?,?,?,?,?)').run(id, provider, keyHash, requestHash, 'executing', JSON.stringify(change), this.now()); }
    catch {
      const raced = this.store.db.prepare('SELECT id,provider,request_hash,state,result FROM web_operations WHERE key_hash=?').get(keyHash) as Row | undefined;
      if (!raced || raced.provider !== provider || raced.request_hash !== requestHash) throw new ConnectorError('conflict', 'Idempotency key was used for different content.');
      return this.result(raced);
    }
    try {
      const receipt = receiptSchema.parse(await writer.create(change));
      if (receipt.containerId !== change.containerId || !await writer.verify(receipt, change)) throw new ConnectorError('outcome_unknown', 'Write could not be verified.');
      this.store.db.prepare("UPDATE web_operations SET state='succeeded',payload=NULL,result=? WHERE id=?").run(JSON.stringify(receipt), id);
      this.store.audit({ at: this.now(), source: 'web', operationId: id, provider, action: 'create', outcome: 'succeeded', count: 1, target: change.containerId, durationMs: this.now() - startedAt });
    } catch {
      this.store.db.prepare("UPDATE web_operations SET state='outcome_unknown',payload=NULL WHERE id=?").run(id);
      this.store.audit({ at: this.now(), source: 'web', operationId: id, provider, action: 'create', outcome: 'outcome_unknown', count: 1, target: change.containerId, durationMs: this.now() - startedAt, errorCode: 'outcome_unknown' });
    }
    return this.get(id);
  }
}
