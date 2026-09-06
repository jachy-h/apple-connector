import { z } from 'zod';
import { ConnectorError } from '../../application/errors.js';
import { capabilities } from '../../application/capabilities.js';
import { Store } from '../../storage/database.js';
import { ReminderOperations } from '../../operations/reminders.js';
import { NoteOperations } from '../../operations/notes.js';
import { JxaNoteReader } from '../../providers/notes/jxa-reader.js';
import { JxaReminderReader } from '../../providers/reminders/jxa-reader.js';
import { JxaCalendarReader } from '../../providers/calendar/jxa-reader.js';
import { authorize, projectCalendarEvent } from '../../policy/authorize.js';
import { rpcOk, rpcFail, agentMethods, adminMethods } from './rpc.js';
import type { RpcMethod, RpcResponse } from './rpc.js';
import { safeEqualToken } from './paths.js';

const operationRefParamsSchema = z.object({ id: z.string().min(1).max(128) }).strict();

/** Application service facade. MCP and the local HTTP transport are thin clients of this boundary. */
export class ServiceFacade {
  constructor(
    private readonly store: Store,
    private readonly operations: ReminderOperations,
    private readonly adminToken: string,
    private readonly version: string,
    private readonly notes?: NoteOperations,
    private readonly noteReader?: JxaNoteReader,
    private readonly reminderReader?: JxaReminderReader,
    private readonly calendarReader?: JxaCalendarReader,
  ) {}

  private reader(): JxaNoteReader {
    if (!this.noteReader) throw new ConnectorError('service_unavailable', 'Notes reader is not configured.');
    return this.noteReader;
  }
  private remindersReader(): JxaReminderReader {
    if (!this.reminderReader) throw new ConnectorError('service_unavailable', 'Reminders reader is not configured.');
    return this.reminderReader;
  }
  private calendarsReader(): JxaCalendarReader {
    if (!this.calendarReader) throw new ConnectorError('service_unavailable', 'Calendar reader is not configured.');
    return this.calendarReader;
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
          const names = [...new Set(client.grants.filter((grant) => grant.provider === 'calendar' && grant.actions.includes('read') && grant.expiresAt > Date.now())
            .flatMap((grant) => grant.containerIds))];
          return rpcOk(await this.calendarsReader().listCalendars(names));
        }
        case 'calendar.list_events': {
          const parsed = z.object({ calendarId: z.string().min(1).max(512), from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict().superRefine((value, context) => {
            if (Date.parse(value.to) <= Date.parse(value.from)) context.addIssue({ code: 'custom', message: 'Time range must be increasing.' });
          }).parse(params);
          const client = this.store.authenticate(token); const grant = authorize(client, 'calendar', parsed.calendarId, 'read');
          const page = await this.calendarsReader().listEvents(parsed.calendarId, parsed.from, parsed.to, parsed.offset, parsed.limit);
          return rpcOk({ items: page.items.map((event) => projectCalendarEvent(event, grant.fields)), nextOffset: page.nextOffset });
        }
        case 'reminders.list_lists': {
          const client = this.store.authenticate(token);
          const ids = [...new Set(client.grants.filter((grant) => grant.provider === 'reminders' && grant.actions.includes('read') && grant.expiresAt > Date.now())
            .flatMap((grant) => grant.containerIds))];
          return rpcOk(await this.remindersReader().listLists(ids));
        }
        case 'reminders.list': {
          const parsed = z.object({ listId: z.string().min(1).max(512), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict().parse(params);
          const client = this.store.authenticate(token); authorize(client, 'reminders', parsed.listId, 'read');
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
          return rpcOk(change?.kind === 'notes.create' && this.notes ? this.notes.prepare(token, params) : this.operations.prepare(token, params));
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
      if (!adminMethods.has(method)) throw new ConnectorError('permission_denied', 'Agent method cannot be called with admin credentials.');
      if (!safeEqualToken(token, this.adminToken)) throw new ConnectorError('permission_denied', 'Invalid admin session.');
      return this.runAdmin(method, params);
    } catch (error) { return rpcFail(error); }
  }

  /** Only AdminWebServer calls this after its loopback session, Host and CSRF checks. */
  async management(method: RpcMethod, params: unknown): Promise<RpcResponse> {
    try {
      if (!adminMethods.has(method)) throw new ConnectorError('permission_denied', 'Agent method is not available to management.');
      return this.runAdmin(method, params);
    } catch (error) { return rpcFail(error); }
  }

  private runAdmin(method: RpcMethod, params: unknown): RpcResponse {
      switch (method) {
        case 'clients.list': return rpcOk(this.store.listClients());
        case 'clients.create': return rpcOk(this.store.createClient(params));
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
        case 'audit.list': return rpcOk(this.store.auditEvents());
        case 'audit.summary': return rpcOk(this.store.auditSummary());
        case 'audit.clear': {
          this.store.clearAudit();
          return rpcOk({ cleared: true });
        }
        case 'operations.list': return rpcOk(this.store.listOperations());
      }
      throw new ConnectorError('invalid_request', 'Unhandled admin method.');
  }

  /** Single entry point for the local transport; pick the credential class by method. */
  async dispatch(method: RpcMethod, params: unknown, token: string): Promise<RpcResponse> {
    return agentMethods.has(method) ? this.agent(method, params, token) : this.admin(method, params, token);
  }
}
