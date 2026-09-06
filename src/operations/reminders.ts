import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConnectorError } from '../application/errors.js';
import { authorize } from '../policy/authorize.js';
import { Store, digest } from '../storage/database.js';
import { createReminderSchema, reminderReceiptSchema } from '../providers/reminders/types.js';
import type { ReminderWriter, CreateReminder } from '../providers/reminders/types.js';

interface OperationRow {
  id: string; client_id: string; request_hash: string; policy_version: number;
  state: string; payload: string | null; expires_at: number; result: string | null;
}
const prepareSchema = z.object({
  idempotencyKey: z.string().min(1).max(128), change: createReminderSchema,
}).strict();

/** Internal application service. A native writer is injected only after its M0 gate passes. */
export class ReminderOperations {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: Store, private readonly writer: ReminderWriter, private readonly now = Date.now) {
    // Reopening after a crash must never replay a potentially completed mutation.
    store.db.prepare("UPDATE operations SET state='outcome_unknown',payload=NULL WHERE state='executing'").run();
  }

  prepare(token: string, raw: unknown) {
    const client = this.store.authenticate(token);
    const { idempotencyKey, change } = prepareSchema.parse(raw);
    this.store.pruneOperations(this.now());
    let grant;
    try { grant = authorize(client, 'reminders', change.containerId, 'create', this.now()); }
    catch (error) {
      this.store.audit({ at: this.now(), clientId: client.id, provider: 'reminders', action: 'create', outcome: 'denied', count: 0, errorCode: 'permission_denied' });
      throw error;
    }
    const hash = digest(JSON.stringify(change));
    const existing = this.store.db.prepare('SELECT * FROM operations WHERE client_id=? AND key_hash=?')
      .get(client.id, digest(idempotencyKey)) as unknown as OperationRow | undefined;
    if (existing) {
      if (existing.request_hash !== hash) throw new ConnectorError('conflict', 'Idempotency key was used for different content.');
      return this.result(existing);
    }
    this.store.assertOperationCapacity(Buffer.byteLength(JSON.stringify(change)));
    const id = randomUUID();
    const state = grant.approval === 'required' ? 'prepared' : 'approved';
    this.store.db.prepare(`INSERT INTO operations
      (id,client_id,provider,key_hash,request_hash,policy_version,state,payload,expires_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, client.id, 'reminders', digest(idempotencyKey), hash, client.policyVersion,
        state, JSON.stringify(change), Math.min(this.now() + 15 * 60_000, grant.expiresAt), this.now());
    return this.get(token, id);
  }

  // Management-only method; never expose through an agent transport.
  approve(id: string): void {
    const row = this.row(id);
    this.validate(row);
    if (row.state !== 'prepared') throw new ConnectorError('conflict', 'Plan is not awaiting approval.');
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE operations SET state='approved' WHERE id=?").run(id);
      this.store.audit({ at: this.now(), clientId: row.client_id, operationId: id, action: 'approved', outcome: 'allowed', count: 1 });
    });
  }

  commit(token: string, id: string): Promise<ReturnType<ReminderOperations['get']>> {
    const work = this.tail.then(() => this.execute(token, id));
    this.tail = work.catch(() => undefined);
    return work;
  }

  get(token: string, id: string) {
    const client = this.store.authenticate(token);
    const row = this.row(id);
    if (row.client_id !== client.id) throw new ConnectorError('permission_denied', 'Plan belongs to another client.');
    return this.result(row);
  }

  private result(row: OperationRow) {
    return { id: row.id, state: row.state, expiresAt: row.expires_at,
      result: row.result ? reminderReceiptSchema.parse(JSON.parse(row.result)) : null };
  }

  private row(id: string): OperationRow {
    const row = this.store.db.prepare('SELECT * FROM operations WHERE id=?').get(id) as unknown as OperationRow | undefined;
    if (!row) throw new ConnectorError('permission_denied', 'Unknown or inaccessible plan.');
    return row;
  }

  private validate(row: OperationRow): CreateReminder {
    if (row.expires_at <= this.now()) throw new ConnectorError('conflict', 'Plan expired; prepare a new plan.');
    const client = this.store.client(row.client_id);
    if (client.revoked || client.policyVersion !== row.policy_version) throw new ConnectorError('permission_denied', 'Plan authorization changed.');
    if (!row.payload) throw new ConnectorError('conflict', 'Plan is no longer executable.');
    const change = createReminderSchema.parse(JSON.parse(row.payload));
    authorize(client, 'reminders', change.containerId, 'create', this.now());
    return change;
  }

  private async execute(token: string, id: string) {
    const client = this.store.authenticate(token);
    let row = this.row(id);
    if (row.client_id !== client.id) throw new ConnectorError('permission_denied', 'Plan belongs to another client.');
    if (['succeeded', 'outcome_unknown', 'failed', 'cancelled', 'expired'].includes(row.state)) return this.result(row);
    const change = this.validate(row);
    if (row.state !== 'approved') throw new ConnectorError('approval_required', 'Approve this plan in the management interface.');
    await this.writer.preflight(change);
    // A user can revoke access while native preflight is in flight.
    row = this.row(id);
    this.validate(row);
    if (row.state !== 'approved') throw new ConnectorError('conflict', 'Plan is no longer approved.');
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE operations SET state='executing' WHERE id=?").run(id);
      this.store.audit({ at: this.now(), clientId: client.id, operationId: id, provider: 'reminders', action: 'create', outcome: 'allowed', count: 1, policyVersion: row.policy_version });
    });
    try {
      const receipt = reminderReceiptSchema.parse(await this.writer.create(change));
      if (receipt.containerId !== change.containerId || !await this.writer.verify(receipt, change)) {
        throw new ConnectorError('outcome_unknown', 'Write could not be verified.');
      }
      this.store.transaction(() => {
        this.store.db.prepare("UPDATE operations SET state='succeeded',payload=NULL,result=? WHERE id=?").run(JSON.stringify(receipt), id);
        this.store.audit({ at: this.now(), clientId: client.id, operationId: id, provider: 'reminders', action: 'create', outcome: 'succeeded', count: 1 });
      });
    } catch {
      // Any exception after durable intent may follow a completed native write, including DB failure.
      try {
        this.store.transaction(() => {
          this.store.db.prepare("UPDATE operations SET state='outcome_unknown',payload=NULL WHERE id=?").run(id);
          this.store.audit({ at: this.now(), clientId: client.id, operationId: id, provider: 'reminders', action: 'create', outcome: 'outcome_unknown', count: 1, errorCode: 'outcome_unknown' });
        });
      } catch { /* Persisted executing intent is recovered as unknown on restart. */ }
      throw new ConnectorError('outcome_unknown', 'Write result is uncertain; do not retry with a new key.');
    }
    return this.result(this.row(id));
  }
}
