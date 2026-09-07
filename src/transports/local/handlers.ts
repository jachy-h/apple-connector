import { z } from 'zod';
import { ConnectorError } from '../../application/errors.js';
import { capabilities } from '../../application/capabilities.js';
import { Store } from '../../storage/database.js';
import { ReminderOperations } from '../../operations/reminders.js';
import { NoteOperations } from '../../operations/notes.js';
import { JxaNoteReader } from '../../providers/notes/jxa-reader.js';
import type { ReminderReader } from '../../providers/reminders/eventkit.js';
import type { CalendarReader } from '../../providers/calendar/eventkit.js';
import { authorize, projectCalendarEvent } from '../../policy/authorize.js';
import type { Client, Grant } from '../../policy/schema.js';
import { rpcOk, rpcFail, agentMethods, adminMethods, localAdminMethods } from './rpc.js';
import type { RpcMethod, RpcResponse } from './rpc.js';
import { safeEqualToken } from './paths.js';
import { PROTOCOL_VERSION } from '../../jxa/protocol.js';
import { WebWrites } from '../../application/web-writes.js';

const operationRefParamsSchema = z.object({ id: z.string().min(1).max(128) }).strict();
const pageSchema = z.object({ offset: z.number().int().min(0).max(20_000).default(0), limit: z.number().int().min(1).max(200).default(50) }).strict();
const operationQuerySchema = pageSchema.extend({ provider: z.enum(['calendar', 'reminders', 'notes']).optional(), clientId: z.string().min(1).max(128).optional(), state: z.string().min(1).max(64).optional() });
const auditQuerySchema = pageSchema.extend({ provider: z.enum(['calendar', 'reminders', 'notes']).optional(), clientId: z.string().min(1).max(128).optional(), source: z.enum(['client', 'web']).optional(), outcome: z.enum(['allowed', 'denied', 'succeeded', 'failed', 'outcome_unknown']).optional(), from: z.number().int().nonnegative().optional(), to: z.number().int().nonnegative().optional() }).superRefine((value, context) => { if (value.from !== undefined && value.to !== undefined && value.from > value.to) context.addIssue({ code: 'custom', message: 'The start time must not be after the end time.' }); });
const containerSchema = z.object({ containerId: z.string().min(1).max(512) }).strict();
const probeSchema = z.object({ probeId: z.string().uuid() }).strict();
const permissionRequestSchema = z.object({ provider: z.enum(['calendar', 'reminders']) }).strict();
const containerNameSchema = z.object({ name: z.string().trim().min(1).max(500) }).strict();
const readSummarySchema = z.object({ clientId: z.string().uuid(), provider: z.enum(['reminders', 'notes']), containerId: z.string().min(1).max(512), limit: z.number().int().min(1).max(20).default(10) }).strict();
const webCalendarSchema = z.object({ calendarId: z.string().trim().min(1).max(512), from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict().superRefine((value, context) => { if (Date.parse(value.to) <= Date.parse(value.from)) context.addIssue({ code: 'custom', message: 'Time range must be increasing.' }); });
const webReminderSchema = z.object({ listId: z.string().trim().min(1).max(512), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict();
const webNoteSearchSchema = z.object({ folderId: z.string().trim().min(1).max(512), query: z.string().max(500), limit: z.number().int().min(1).max(100).default(50) }).strict();
const webNoteGetSchema = z.object({ folderId: z.string().trim().min(1).max(512), id: z.string().trim().min(1).max(512) }).strict();
const webWriteSchema = z.object({ idempotencyKey: z.string().uuid(), change: z.unknown() }).strict();

export interface ManagementDiagnostics {
  startReminderM1(containerId: string): { probeId: string; containerId: string; createdAt: number };
  listReminderM1(): unknown[];
  recoverReminderM1(probeId: string): { probeId: string; status: string };
  findContainers(name: string): Promise<unknown>;
  runProbe(): Promise<unknown>;
  permissionStatus?(): Promise<unknown>;
  requestPermission?(provider: 'calendar' | 'reminders'): Promise<unknown>;
}

/** Application service facade. MCP and the local HTTP transport are thin clients of this boundary. */
export class ServiceFacade {
  constructor(
    private readonly store: Store,
    private readonly operations: ReminderOperations,
    private readonly adminToken: string,
    private readonly version: string,
    private readonly notes?: NoteOperations,
    private readonly noteReader?: JxaNoteReader,
    private readonly reminderReader?: ReminderReader,
    private readonly calendarReader?: CalendarReader,
    private readonly issueManagementLink?: () => string,
    private readonly diagnostics?: ManagementDiagnostics,
    private readonly webWrites?: WebWrites,
  ) {}

  private reader(): JxaNoteReader {
    if (!this.noteReader) throw new ConnectorError('service_unavailable', 'Notes reader is not configured.');
    return this.noteReader;
  }
  private remindersReader(): ReminderReader {
    if (!this.reminderReader) throw new ConnectorError('service_unavailable', 'Reminders reader is not configured.');
    return this.reminderReader;
  }
  private calendarsReader(): CalendarReader {
    if (!this.calendarReader) throw new ConnectorError('service_unavailable', 'Calendar reader is not configured.');
    return this.calendarReader;
  }

  /** Resolve legacy name scopes to exactly one current EventKit identifier. */
  private async calendarGrant(client: Client, calendarId: string): Promise<Grant> {
    try { return authorize(client, 'calendar', calendarId, 'read'); } catch { /* Legacy scopes may be names. */ }
    for (const grant of client.grants.filter((item) => item.provider === 'calendar' && item.actions.includes('read') && item.expiresAt > Date.now())) {
      for (const scope of grant.containerIds) {
        const matches = await this.calendarsReader().listCalendars([scope]);
        if (matches.length > 1) throw new ConnectorError('conflict', 'A Calendar name scope is ambiguous; select and authorize its EventKit ID explicitly.');
        if (matches[0]?.id === calendarId) return grant;
      }
    }
    throw new ConnectorError('permission_denied', 'Operation is outside the granted scope.');
  }

  private async reminderGrant(client: Client, listId: string): Promise<Grant> {
    try { return authorize(client, 'reminders', listId, 'read'); } catch { /* Legacy scopes may be names. */ }
    for (const grant of client.grants.filter((item) => item.provider === 'reminders' && item.actions.includes('read') && item.expiresAt > Date.now())) {
      for (const scope of grant.containerIds) {
        const matches = await this.remindersReader().listLists([scope]);
        if (matches.length > 1) throw new ConnectorError('conflict', 'A Reminders name scope is ambiguous; select and authorize its EventKit ID explicitly.');
        if (matches[0]?.id === listId) return grant;
      }
    }
    throw new ConnectorError('permission_denied', 'Operation is outside the granted scope.');
  }

  private noteOperation(id: string): NoteOperations {
    if (!this.notes) throw new ConnectorError('unsupported_operation', 'Notes operations are not configured.');
    if (this.store.operationProvider(id) !== 'notes') throw new ConnectorError('unsupported_operation', 'Operation belongs to a different provider.');
    return this.notes;
  }

  /** Agent-facing requests carry a client bearer token. */
  async agent(method: RpcMethod, params: unknown, token: string): Promise<RpcResponse> {
    try {
      if (!agentMethods.has(method)) throw new ConnectorError('permission_denied', 'Management method is not available to agents.');
      this.store.authenticate(token);
      switch (method) {
        case 'capabilities': return rpcOk({ version: this.version, capabilities: capabilities() });
        case 'calendar.list_calendars': {
          const client = this.store.authenticate(token);
          const scopes = [...new Set(client.grants.filter((grant) => grant.provider === 'calendar' && grant.actions.includes('read') && grant.expiresAt > Date.now()).flatMap((grant) => grant.containerIds))];
          const groups = await Promise.all(scopes.map((scope) => this.calendarsReader().listCalendars([scope])));
          if (groups.some((items) => items.length > 1)) throw new ConnectorError('conflict', 'A Calendar name scope is ambiguous; select and authorize its EventKit ID explicitly.');
          return rpcOk([...new Map(groups.flat().map((item) => [item.id, item])).values()]);
        }
        case 'calendar.list_events': {
          const parsed = z.object({ calendarId: z.string().min(1).max(512), from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict().superRefine((value, context) => {
            if (Date.parse(value.to) <= Date.parse(value.from)) context.addIssue({ code: 'custom', message: 'Time range must be increasing.' });
          }).parse(params);
          const client = this.store.authenticate(token); const grant = await this.calendarGrant(client, parsed.calendarId);
          const page = await this.calendarsReader().listEvents(parsed.calendarId, parsed.from, parsed.to, parsed.offset, parsed.limit);
          return rpcOk({ items: page.items.map((event) => projectCalendarEvent(event, grant.fields)), nextOffset: page.nextOffset });
        }
        case 'reminders.list_lists': {
          const client = this.store.authenticate(token);
          const scopes = [...new Set(client.grants.filter((grant) => grant.provider === 'reminders' && grant.actions.includes('read') && grant.expiresAt > Date.now()).flatMap((grant) => grant.containerIds))];
          const groups = await Promise.all(scopes.map((scope) => this.remindersReader().listLists([scope])));
          if (groups.some((items) => items.length > 1)) throw new ConnectorError('conflict', 'A Reminders name scope is ambiguous; select and authorize its EventKit ID explicitly.');
          return rpcOk([...new Map(groups.flat().map((item) => [item.id, item])).values()]);
        }
        case 'reminders.list': {
          const parsed = z.object({ listId: z.string().min(1).max(512), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict().parse(params);
          const client = this.store.authenticate(token); await this.reminderGrant(client, parsed.listId);
          return rpcOk(await this.remindersReader().list(parsed.listId, parsed.offset, parsed.limit));
        }
        case 'notes.list_folders': {
          const client = this.store.authenticate(token);
          const ids = [...new Set(client.grants.filter((grant) => grant.provider === 'notes' && grant.actions.includes('read') && grant.expiresAt > Date.now())
            .flatMap((grant) => grant.containerIds))];
          return rpcOk(await this.reader().listFolders(ids));
        }
        case 'notes.get': {
          const parsed = z.object({ folderId: z.string().min(1).max(512), id: z.string().min(1).max(512) }).strict().parse(params);
          const client = this.store.authenticate(token); authorize(client, 'notes', parsed.folderId, 'read');
          return rpcOk(await this.reader().get(parsed.folderId, parsed.id));
        }
        case 'notes.search': {
          const parsed = z.object({ folderId: z.string().min(1).max(512), query: z.string().max(500), limit: z.number().int().min(1).max(100).default(50) }).strict().parse(params);
          const client = this.store.authenticate(token); authorize(client, 'notes', parsed.folderId, 'read');
          return rpcOk(await this.reader().search(parsed.folderId, parsed.query, parsed.limit));
        }
        case 'operations.prepare': {
          const change = params && typeof params === 'object' ? (params as { change?: { kind?: unknown } }).change : undefined;
          if (change?.kind === 'notes.create') throw new ConnectorError('unsupported_operation', 'Notes is read-only in v0.5.0.');
          return rpcOk(this.operations.prepare(token, params));
        }
        case 'operations.commit': {
          const { id } = operationRefParamsSchema.parse(params);
          this.store.authenticate(token);
          return rpcOk(await (this.store.operationProvider(id) === 'notes' ? this.noteOperation(id).commit(token, id) : this.operations.commit(token, id)));
        }
        case 'operations.get': {
          const { id } = operationRefParamsSchema.parse(params);
          this.store.authenticate(token);
          return rpcOk(this.store.operationProvider(id) === 'notes' ? this.noteOperation(id).get(token, id) : this.operations.get(token, id));
        }
      }
      throw new ConnectorError('invalid_request', 'Unhandled agent method.');
    } catch (error) { return rpcFail(error); }
  }

  /** Management requests require the local admin token held by setup/CLI/web. */
  async admin(method: RpcMethod, params: unknown, token: string): Promise<RpcResponse> {
    try {
      if (!localAdminMethods.has(method)) throw new ConnectorError('permission_denied', 'Agent method cannot be called with admin credentials.');
      if (!safeEqualToken(token, this.adminToken)) throw new ConnectorError('permission_denied', 'Invalid admin session.');
      return await this.runAdmin(method, params);
    } catch (error) { return rpcFail(error); }
  }

  /** Only AdminWebServer calls this after its loopback session, Host and CSRF checks. */
  async management(method: RpcMethod, params: unknown): Promise<RpcResponse> {
    try {
      if (!adminMethods.has(method)) throw new ConnectorError('permission_denied', 'Agent method is not available to management.');
      return await this.runAdmin(method, params);
    } catch (error) { return rpcFail(error); }
  }

  private async runAdmin(method: RpcMethod, params: unknown): Promise<RpcResponse> {
      switch (method) {
        case 'clients.list': return rpcOk(this.store.listClients());
        case 'clients.create': return rpcOk(this.store.createClient(params));
        case 'clients.update': {
          const parsed = z.object({ id: z.string().min(1).max(128), name: z.string(), grants: z.array(z.unknown()) }).strict().parse(params);
          return rpcOk(this.store.updateClient(parsed.id, { name: parsed.name, grants: parsed.grants }));
        }
        case 'clients.rotate': {
          const { id } = operationRefParamsSchema.parse(params);
          return rpcOk(this.store.rotateClientToken(id));
        }
        case 'clients.revoke': {
          const { id } = operationRefParamsSchema.parse(params);
          this.store.revoke(id);
          return rpcOk({ revoked: id });
        }
        case 'operations.approve': {
          const { id } = operationRefParamsSchema.parse(params);
          if (this.store.operationProvider(id) === 'notes') this.noteOperation(id).approve(id); else this.operations.approve(id);
          return rpcOk({ approved: id });
        }
        case 'operations.reject': {
          const { id } = operationRefParamsSchema.parse(params);
          this.store.rejectOperation(id);
          return rpcOk({ rejected: id });
        }
        case 'operations.preview': {
          const { id } = operationRefParamsSchema.parse(params);
          return rpcOk(this.store.operationPreview(id));
        }
        case 'audit.list': return rpcOk(this.store.auditEvents());
        case 'audit.query': return rpcOk(this.store.queryAudit(auditQuerySchema.parse(params)));
        case 'audit.summary': return rpcOk(this.store.auditSummary());
        case 'audit.clear': {
          this.store.clearAudit();
          return rpcOk({ cleared: true });
        }
        case 'operations.list': return rpcOk(this.store.listOperations());
        case 'operations.query': return rpcOk(this.store.queryOperations(operationQuerySchema.parse(params)));
        case 'diagnostics.summary': return rpcOk({
          version: this.version,
          nativeProtocolVersion: PROTOCOL_VERSION,
          storage: this.store.diagnostics(),
          audit: this.store.auditSummary(),
          systemPermissions: this.diagnostics?.permissionStatus ? await this.diagnostics.permissionStatus() : 'not_probed',
        });
        case 'diagnostics.reminders_m1.start': {
          if (!this.diagnostics) throw new ConnectorError('service_unavailable', 'Managed diagnostics are not configured.');
          const parsed = containerSchema.safeParse(params);
          if (!parsed.success) throw new ConnectorError('invalid_request', 'A dedicated Reminders list ID is required.');
          return rpcOk(this.diagnostics.startReminderM1(parsed.data.containerId));
        }
        case 'diagnostics.reminders_m1.list': {
          if (!this.diagnostics) throw new ConnectorError('service_unavailable', 'Managed diagnostics are not configured.');
          return rpcOk(this.diagnostics.listReminderM1());
        }
        case 'diagnostics.reminders_m1.recover': {
          if (!this.diagnostics) throw new ConnectorError('service_unavailable', 'Managed diagnostics are not configured.');
          const parsed = probeSchema.safeParse(params);
          if (!parsed.success) throw new ConnectorError('invalid_request', 'A valid diagnostic probe UUID is required.');
          return rpcOk(this.diagnostics.recoverReminderM1(parsed.data.probeId));
        }
        case 'diagnostics.find_containers': {
          if (!this.diagnostics) throw new ConnectorError('service_unavailable', 'Managed diagnostics are not configured.');
          const parsed = containerNameSchema.safeParse(params);
          if (!parsed.success) throw new ConnectorError('invalid_request', 'An exact container name is required.');
          return rpcOk(await this.diagnostics.findContainers(parsed.data.name));
        }
        case 'diagnostics.probe': {
          if (!this.diagnostics) throw new ConnectorError('service_unavailable', 'Managed diagnostics are not configured.');
          return rpcOk(await this.diagnostics.runProbe());
        }
        case 'diagnostics.permissions.request': {
          if (!this.diagnostics?.requestPermission) throw new ConnectorError('service_unavailable', 'Permission management is not configured.');
          return rpcOk(await this.diagnostics.requestPermission(permissionRequestSchema.parse(params).provider));
        }
        case 'diagnostics.read_summary': {
          const parsed = readSummarySchema.safeParse(params);
          if (!parsed.success) throw new ConnectorError('invalid_request', 'Select an active client, a supported provider, an authorized container, and a bounded limit.');
          const client = this.store.client(parsed.data.clientId);
          if (client.revoked) throw new ConnectorError('permission_denied', 'The selected client is revoked.');
          authorize(client, parsed.data.provider, parsed.data.containerId, 'read');
          const result = parsed.data.provider === 'reminders'
            ? await this.remindersReader().list(parsed.data.containerId, 0, parsed.data.limit)
            : await this.reader().search(parsed.data.containerId, '', parsed.data.limit);
          const count = Array.isArray(result) ? result.length : result.items.length;
          this.store.audit({ at: Date.now(), clientId: client.id, provider: parsed.data.provider, action: 'read', outcome: 'allowed', count, policyVersion: client.policyVersion });
          return rpcOk({ provider: parsed.data.provider, containerId: parsed.data.containerId, count, ...(Array.isArray(result) || result.nextOffset === null ? {} : { nextOffset: result.nextOffset }), limitedTo: parsed.data.limit, contentReturned: false });
        }
        // These endpoints are deliberately available only through the authenticated loopback
        // management server. They never accept a bearer token or invoke an agent transport.
        case 'web.find_containers': {
          if (!this.diagnostics) throw new ConnectorError('service_unavailable', 'Container discovery is not configured.');
          const startedAt = Date.now();
          const parsed = containerNameSchema.parse(params);
          const result = await this.diagnostics.findContainers(parsed.name);
          this.store.audit({ at: Date.now(), source: 'web', action: 'read', outcome: 'succeeded', count: 0, target: parsed.name, durationMs: Date.now() - startedAt });
          return rpcOk(result);
        }
        case 'web.calendar.list_events': {
          const parsed = webCalendarSchema.parse(params);
          const startedAt = Date.now();
          try {
            const result = await this.calendarsReader().listEvents(parsed.calendarId, parsed.from, parsed.to, parsed.offset, parsed.limit);
            this.store.audit({ at: Date.now(), source: 'web', provider: 'calendar', action: 'read', outcome: 'succeeded', count: result.items.length, target: parsed.calendarId, durationMs: Date.now() - startedAt });
            return rpcOk(result);
          } catch (error) {
            this.store.audit({ at: Date.now(), source: 'web', provider: 'calendar', action: 'read', outcome: 'failed', count: 0, target: parsed.calendarId, durationMs: Date.now() - startedAt, errorCode: 'service_unavailable' });
            throw error;
          }
        }
        case 'web.reminders.list': {
          const parsed = webReminderSchema.parse(params);
          const startedAt = Date.now();
          try {
            const result = await this.remindersReader().list(parsed.listId, parsed.offset, parsed.limit);
            this.store.audit({ at: Date.now(), source: 'web', provider: 'reminders', action: 'read', outcome: 'succeeded', count: result.items.length, target: parsed.listId, durationMs: Date.now() - startedAt });
            return rpcOk(result);
          } catch (error) {
            this.store.audit({ at: Date.now(), source: 'web', provider: 'reminders', action: 'read', outcome: 'failed', count: 0, target: parsed.listId, durationMs: Date.now() - startedAt, errorCode: 'service_unavailable' });
            if (error instanceof ConnectorError && error.code === 'unsupported_operation') {
              throw new ConnectorError('unsupported_operation', '无法解析此提醒事项清单 ID。请先按精确名称发现，再选择“使用此 ID”后重试。');
            }
            throw error;
          }
        }
        case 'web.notes.search': {
          const parsed = webNoteSearchSchema.parse(params);
          const startedAt = Date.now();
          try {
            const result = await this.reader().search(parsed.folderId, parsed.query, parsed.limit);
            this.store.audit({ at: Date.now(), source: 'web', provider: 'notes', action: 'read', outcome: 'succeeded', count: result.length, target: parsed.folderId, durationMs: Date.now() - startedAt });
            return rpcOk(result);
          } catch (error) {
            this.store.audit({ at: Date.now(), source: 'web', provider: 'notes', action: 'read', outcome: 'failed', count: 0, target: parsed.folderId, durationMs: Date.now() - startedAt, errorCode: 'service_unavailable' });
            throw error;
          }
        }
        case 'web.notes.get': {
          const parsed = webNoteGetSchema.parse(params);
          const startedAt = Date.now();
          try {
            const result = await this.reader().get(parsed.folderId, parsed.id);
            this.store.audit({ at: Date.now(), source: 'web', provider: 'notes', action: 'read', outcome: 'succeeded', count: 1, target: parsed.folderId, durationMs: Date.now() - startedAt });
            return rpcOk(result);
          } catch (error) {
            this.store.audit({ at: Date.now(), source: 'web', provider: 'notes', action: 'read', outcome: 'failed', count: 0, target: parsed.folderId, durationMs: Date.now() - startedAt, errorCode: 'service_unavailable' });
            throw error;
          }
        }
        case 'web.reminders.create': {
          if (!this.webWrites) throw new ConnectorError('service_unavailable', 'Web writes are not configured.');
          const parsed = webWriteSchema.parse(params);
          return rpcOk(await this.webWrites.submitReminders(parsed.idempotencyKey, parsed.change));
        }
        case 'web.reminders.update': {
          if (!this.webWrites) throw new ConnectorError('service_unavailable', 'Web writes are not configured.');
          const parsed = webWriteSchema.parse(params);
          return rpcOk(await this.webWrites.submitReminderUpdate(parsed.idempotencyKey, parsed.change));
        }
        case 'web.reminders.delete': {
          if (!this.webWrites) throw new ConnectorError('service_unavailable', 'Web writes are not configured.');
          const parsed = webWriteSchema.parse(params);
          return rpcOk(await this.webWrites.submitReminderDelete(parsed.idempotencyKey, parsed.change));
        }
        case 'web.operations.get': {
          if (!this.webWrites) throw new ConnectorError('service_unavailable', 'Web writes are not configured.');
          const { id } = operationRefParamsSchema.parse(params);
          return rpcOk(this.webWrites.get(id));
        }
        case 'management.service_info': return rpcOk({ version: this.version });
        case 'management.issue_link': {
          if (!this.issueManagementLink) throw new ConnectorError('service_unavailable', 'Management site is not configured.');
          return rpcOk({ url: this.issueManagementLink() });
        }
      }
      throw new ConnectorError('invalid_request', 'Unhandled admin method.');
  }

  /** Single entry point for the local transport; pick the credential class by method. */
  async dispatch(method: RpcMethod, params: unknown, token: string): Promise<RpcResponse> {
    return agentMethods.has(method) ? this.agent(method, params, token) : this.admin(method, params, token);
  }
}
