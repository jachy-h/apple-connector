import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConnectorError } from '../application/errors.js';
import { authorize } from '../policy/authorize.js';
import type { Action, Client, Grant } from '../policy/schema.js';
import { Store, digest } from '../storage/database.js';
import { completeReminderSchema, createReminderSchema, deleteReminderSchema, reminderReceiptSchema, updateReminderSchema } from '../providers/reminders/types.js';
import type { ReminderWriter } from '../providers/reminders/types.js';
import type { AgentReminderMutator, ReminderReader } from '../providers/reminders/eventkit.js';
import { calendarEventReceiptSchema, createCalendarEventSchema, deleteCalendarEventSchema, updateCalendarEventSchema } from '../providers/calendar/types.js';
import type { CalendarWriter } from '../providers/calendar/types.js';
import type { CalendarReader } from '../providers/calendar/eventkit.js';

export const agentChangeSchema = z.union([
  createCalendarEventSchema, updateCalendarEventSchema, deleteCalendarEventSchema,
  createReminderSchema, updateReminderSchema, completeReminderSchema, deleteReminderSchema,
]);
export type AgentChange = z.infer<typeof agentChangeSchema>;

type Provider = 'calendar' | 'reminders';
type OperationRow = {
  id: string; client_id: string; provider: Provider; request_hash: string; policy_version: number;
  state: string; payload: string | null; expires_at: number; result: string | null;
};
const prepareSchema = z.object({ idempotencyKey: z.string().min(1).max(128), change: agentChangeSchema }).strict();

function changeAccess(change: AgentChange): { provider: Provider; action: Action } {
  const [provider, verb] = change.kind.split('.') as [Provider, 'create' | 'update' | 'complete' | 'delete'];
  return { provider, action: verb };
}

/** Durable agent mutation service shared by all Calendar and Reminders MCP write tools. */
export class AgentOperations {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: Store,
    private readonly reminders: ReminderWriter & Partial<AgentReminderMutator>,
    private readonly calendars?: CalendarWriter,
    private readonly reminderReader?: ReminderReader,
    private readonly calendarReader?: CalendarReader,
    private readonly now = Date.now,
  ) {
    store.db.prepare("UPDATE operations SET state='outcome_unknown',payload=NULL WHERE state='executing'").run();
  }

  private async grant(client: Client, provider: Provider, containerId: string, action: Action): Promise<Grant> {
    try { return authorize(client, provider, containerId, action, this.now()); }
    catch (error) {
      if (!(error instanceof ConnectorError) || error.code !== 'permission_denied') throw error;
    }
    const candidates = client.grants.filter((grant) => grant.provider === provider && grant.actions.includes(action) && grant.expiresAt > this.now());
    const matched: Grant[] = [];
    for (const candidate of candidates) {
      for (const scope of candidate.containerIds.filter((value) => value !== '*')) {
        const items = provider === 'calendar'
          ? await this.calendarReader?.listCalendars([scope])
          : await this.reminderReader?.listLists([scope]);
        if (!items) continue;
        if (items.length > 1) throw new ConnectorError('conflict', `More than one ${provider === 'calendar' ? 'calendar' : 'Reminders list'} is named "${scope}"; grant an EventKit ID explicitly.`);
        if (items[0]?.id === containerId) matched.push(candidate);
      }
    }
    if (!matched.length) throw new ConnectorError('permission_denied', 'Operation is outside the granted scope.');
    return authorize({ ...client, grants: matched.map((item) => ({ ...item, containerIds: [containerId] })) }, provider, containerId, action, this.now());
  }

  async prepare(token: string, raw: unknown) {
    const client = this.store.authenticate(token);
    const { idempotencyKey, change } = prepareSchema.parse(raw);
    this.store.pruneOperations(this.now());
    const { provider, action } = changeAccess(change);
    let grant: Grant;
    try { grant = await this.grant(client, provider, change.containerId, action); }
    catch (error) {
      const errorCode = error instanceof ConnectorError ? error.code : 'service_unavailable';
      this.store.audit({ at: this.now(), clientId: client.id, provider, action, outcome: 'denied', count: 0, errorCode });
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
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, client.id, provider, digest(idempotencyKey), hash, client.policyVersion,
        state, JSON.stringify(change), Math.min(this.now() + 15 * 60_000, grant.expiresAt), this.now());
    return this.get(token, id);
  }

  async submit(token: string, raw: unknown) {
    const plan = await this.prepare(token, raw);
    return plan.state === 'approved' ? this.commit(token, plan.id) : plan;
  }

  approve(id: string): void {
    const row = this.row(id);
    this.validateMetadata(row);
    if (row.state !== 'prepared') throw new ConnectorError('conflict', 'Plan is not awaiting approval.');
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE operations SET state='approved' WHERE id=?").run(id);
      this.store.audit({ at: this.now(), clientId: row.client_id, operationId: id, action: 'approved', outcome: 'allowed', count: 1 });
    });
  }

  commit(token: string, id: string): Promise<ReturnType<AgentOperations['get']>> {
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
    return { id: row.id, provider: row.provider, state: row.state, expiresAt: row.expires_at,
      result: row.result ? (row.provider === 'calendar' ? calendarEventReceiptSchema : reminderReceiptSchema).parse(JSON.parse(row.result)) : null };
  }

  private row(id: string): OperationRow {
    const row = this.store.db.prepare('SELECT * FROM operations WHERE id=?').get(id) as unknown as OperationRow | undefined;
    if (!row) throw new ConnectorError('permission_denied', 'Unknown or inaccessible plan.');
    return row;
  }

  private validateMetadata(row: OperationRow): void {
    if (row.expires_at <= this.now()) throw new ConnectorError('conflict', 'Plan expired; prepare a new plan.');
    const client = this.store.client(row.client_id);
    if (client.revoked || client.policyVersion !== row.policy_version) throw new ConnectorError('permission_denied', 'Plan authorization changed.');
    if (!row.payload) throw new ConnectorError('conflict', 'Plan is no longer executable.');
  }

  private async validate(row: OperationRow): Promise<AgentChange> {
    this.validateMetadata(row);
    const change = agentChangeSchema.parse(JSON.parse(row.payload!));
    const access = changeAccess(change);
    if (access.provider !== row.provider) throw new ConnectorError('service_unavailable', 'Stored plan provider is invalid.');
    await this.grant(this.store.client(row.client_id), access.provider, change.containerId, access.action);
    return change;
  }

  private async mutate(change: AgentChange): Promise<{ id: string; containerId: string }> {
    switch (change.kind) {
      case 'reminders.create':
        await this.reminders.preflight(change);
        return reminderReceiptSchema.parse(await this.reminders.create(change));
      case 'reminders.update':
        if (!this.reminders.update) throw new ConnectorError('service_unavailable', 'Reminder editing is not configured.');
        return reminderReceiptSchema.parse(await this.reminders.update(change));
      case 'reminders.complete':
        if (!this.reminders.complete) throw new ConnectorError('service_unavailable', 'Reminder completion is not configured.');
        return reminderReceiptSchema.parse(await this.reminders.complete(change));
      case 'reminders.delete':
        if (!this.reminders.remove) throw new ConnectorError('service_unavailable', 'Reminder deletion is not configured.');
        return reminderReceiptSchema.parse(await this.reminders.remove(change));
      case 'calendar.create':
        if (!this.calendars) throw new ConnectorError('service_unavailable', 'Calendar writing is not configured.');
        return calendarEventReceiptSchema.parse(await this.calendars.create(change));
      case 'calendar.update':
        if (!this.calendars) throw new ConnectorError('service_unavailable', 'Calendar writing is not configured.');
        return calendarEventReceiptSchema.parse(await this.calendars.update(change));
      case 'calendar.delete':
        if (!this.calendars) throw new ConnectorError('service_unavailable', 'Calendar writing is not configured.');
        return calendarEventReceiptSchema.parse(await this.calendars.remove(change));
    }
  }

  private async execute(token: string, id: string) {
    const client = this.store.authenticate(token);
    let row = this.row(id);
    if (row.client_id !== client.id) throw new ConnectorError('permission_denied', 'Plan belongs to another client.');
    if (['succeeded', 'outcome_unknown', 'failed', 'cancelled', 'expired'].includes(row.state)) return this.result(row);
    let change = await this.validate(row);
    if (row.state !== 'approved') throw new ConnectorError('approval_required', 'Approve this plan in the management interface.');
    row = this.row(id);
    change = await this.validate(row);
    if (row.state !== 'approved') throw new ConnectorError('conflict', 'Plan is no longer approved.');
    const { provider, action } = changeAccess(change);
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE operations SET state='executing' WHERE id=?").run(id);
      this.store.audit({ at: this.now(), clientId: client.id, operationId: id, provider, action, outcome: 'allowed', count: 1, policyVersion: row.policy_version });
    });
    try {
      const receipt = await this.mutate(change);
      if (receipt.containerId !== change.containerId || ('id' in change && receipt.id !== change.id)) {
        throw new ConnectorError('outcome_unknown', 'Write could not be verified.');
      }
      if (change.kind === 'reminders.create' && !await this.reminders.verify(receipt, change)) {
        throw new ConnectorError('outcome_unknown', 'Write could not be verified.');
      }
      this.store.transaction(() => {
        this.store.db.prepare("UPDATE operations SET state='succeeded',payload=NULL,result=? WHERE id=?").run(JSON.stringify(receipt), id);
        this.store.audit({ at: this.now(), clientId: client.id, operationId: id, provider, action, outcome: 'succeeded', count: 1 });
      });
    } catch (error) {
      const safelyFailed = error instanceof ConnectorError && ['invalid_request', 'permission_denied', 'unsupported_operation'].includes(error.code);
      try {
        this.store.transaction(() => {
          this.store.db.prepare(`UPDATE operations SET state=?,payload=NULL WHERE id=?`).run(safelyFailed ? 'failed' : 'outcome_unknown', id);
          this.store.audit({ at: this.now(), clientId: client.id, operationId: id, provider, action, outcome: safelyFailed ? 'failed' : 'outcome_unknown', count: safelyFailed ? 0 : 1, errorCode: safelyFailed ? error.code : 'outcome_unknown' });
        });
      } catch { /* Persisted executing intent is recovered as unknown on restart. */ }
      if (safelyFailed) throw error;
      throw new ConnectorError('outcome_unknown', 'Write result is uncertain; do not retry with a new key.');
    }
    return this.result(this.row(id));
  }
}
