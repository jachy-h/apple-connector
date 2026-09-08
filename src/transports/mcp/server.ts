import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { appVersion } from '../../application/version.js';
import { publicError } from '../../application/errors.js';
import { createReminderSchema } from '../../providers/reminders/types.js';
import { completeReminderSchema, deleteReminderSchema, updateReminderSchema } from '../../providers/reminders/types.js';
import { createCalendarEventSchema, deleteCalendarEventSchema, updateCalendarEventSchema } from '../../providers/calendar/types.js';
import type { ServiceClient } from '../local/client.js';

function textResult(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function toolError(error: unknown) {
  const public_ = publicError(error);
  return { content: [{ type: 'text' as const, text: JSON.stringify(public_, null, 2) }], isError: true as const };
}

/** MCP tools for agents. Every advertised mutation uses the durable operation state machine. */
export function createMcpServer(client: ServiceClient, token: string): McpServer {
  const mcp = new McpServer({ name: 'apple-connector', version: appVersion }, { capabilities: { tools: {} } });

  mcp.registerTool('connector.capabilities', {
    description: 'Report the service version and each data source capability state without reading personal data.',
    inputSchema: {},
  }, async () => {
    try { return textResult(await client.request('capabilities', undefined, token)); }
    catch (error) { return toolError(error); }
  });

  mcp.registerTool('calendar.list_calendars', {
    description: 'List Calendar containers granted to this client. Use the returned stable ID for event reads and writes.', inputSchema: {},
  }, async () => {
    try { return textResult(await client.request('calendar.list_calendars', undefined, token)); } catch (error) { return toolError(error); }
  });
  mcp.registerTool('calendar.list_events', {
    description: 'List events in one granted calendar by stable ID within a bounded time range. Busy-only grants omit title, location and notes.',
    inputSchema: { calendarId: z.string().min(1).max(512), from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() },
  }, async (args) => {
    try { return textResult(await client.request('calendar.list_events', args, token)); } catch (error) { return toolError(error); }
  });

  const mutation = (name: string, description: string, change: z.ZodTypeAny) => mcp.registerTool(name, {
    description,
    inputSchema: {
      idempotencyKey: z.string().min(1).max(128).describe('Stable client-chosen key. Reuse it only with identical content when recovering a request.'),
      change,
    },
  }, async (args) => {
    try { return textResult(await client.request('operations.submit', args, token)); }
    catch (error) { return toolError(error); }
  });

  mutation('calendar.create_event', 'Create a non-recurring event in an authorized calendar. Automatic grants execute immediately; required grants return a pending operation.', createCalendarEventSchema);
  mutation('calendar.update_event', 'Update one non-recurring event by stable event and calendar IDs in an authorized calendar.', updateCalendarEventSchema);
  mutation('calendar.delete_event', 'Delete one non-recurring event by stable event and calendar IDs in an authorized calendar.', deleteCalendarEventSchema);


  mcp.registerTool('reminders.list_lists', {
    description: 'List only the Reminders lists explicitly granted for reading to this client.', inputSchema: {},
  }, async () => {
    try { return textResult(await client.request('reminders.list_lists', undefined, token)); } catch (error) { return toolError(error); }
  });
  mcp.registerTool('reminders.list', {
    description: 'List reminders from one explicitly granted list with a bounded offset page. Results can be delayed by iCloud synchronization.',
    inputSchema: { listId: z.string().min(1).max(512), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() },
  }, async (args) => {
    try { return textResult(await client.request('reminders.list', args, token)); } catch (error) { return toolError(error); }
  });
  mutation('reminders.create', 'Create a reminder in an authorized list using a durable idempotency key.', createReminderSchema);
  mutation('reminders.update', 'Replace the editable fields and completion state of one reminder in an authorized list.', updateReminderSchema);
  mutation('reminders.complete', 'Mark one reminder complete by stable reminder and list IDs in an authorized list.', completeReminderSchema);
  mutation('reminders.delete', 'Delete one reminder by stable reminder and list IDs in an authorized list.', deleteReminderSchema);
  mcp.registerTool('changes.prepare', {
    description: 'Legacy two-step entry: prepare an immutable reminder-creation plan. Prefer reminders.create for new integrations.',
    inputSchema: {
      idempotencyKey: z.string().min(1).max(128).describe('Client-chosen key; reusing it with different content is rejected.'),
      change: createReminderSchema.describe('Reminder creation targeting a granted container.'),
    },
  }, async (args) => {
    try { return textResult(await client.request('operations.prepare', args, token)); }
    catch (error) { return toolError(error); }
  });

  mcp.registerTool('changes.commit', {
    description: 'Commit a prepared change plan by reference. Only the plan id is accepted; content cannot be swapped at commit time.',
    inputSchema: { id: z.string().min(1).max(128).describe('Plan id returned by changes.prepare.') },
  }, async ({ id }) => {
    try { return textResult(await client.request('operations.commit', { id }, token)); }
    catch (error) { return toolError(error); }
  });

  mcp.registerTool('operations.get', {
    description: 'Read the current state of a change plan (succeeded, failed, outcome_unknown, ...) by id.',
    inputSchema: { id: z.string().min(1).max(128) },
  }, async ({ id }) => {
    try { return textResult(await client.request('operations.get', { id }, token)); }
    catch (error) { return toolError(error); }
  });

  return mcp;
}
