import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { appVersion } from '../../application/version.js';
import { publicError } from '../../application/errors.js';
import { createReminderSchema } from '../../providers/reminders/types.js';
import type { ServiceClient } from '../local/client.js';

function textResult(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function toolError(error: unknown) {
  const public_ = publicError(error);
  return { content: [{ type: 'text' as const, text: JSON.stringify(public_, null, 2) }], isError: true as const };
}

/**
 * MCP tools for agents. Notes read tools are registered after their folder-scoped adapter landed.
 * Calendar and Reminders reads remain absent until their adapters are verified; unavailable tools
 * are never advertised as working capabilities.
 */
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
    description: 'List only Calendar containers explicitly granted to this client. Calendar names must be unique on this Mac.', inputSchema: {},
  }, async () => {
    try { return textResult(await client.request('calendar.list_calendars', undefined, token)); } catch (error) { return toolError(error); }
  });
  mcp.registerTool('calendar.list_events', {
    description: 'List events in one explicitly granted, uniquely named calendar within a bounded time range. Busy-only grants omit title, location and notes.',
    inputSchema: { calendarId: z.string().min(1).max(512), from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() },
  }, async (args) => {
    try { return textResult(await client.request('calendar.list_events', args, token)); } catch (error) { return toolError(error); }
  });


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
  mcp.registerTool('changes.prepare', {
    description: 'Create an immutable change plan for an allowed reminder list. Committing executes the plan; nothing is written until `changes.commit`.',
    inputSchema: {
      idempotencyKey: z.string().min(1).max(128).describe('Client-chosen key; reusing it with different content is rejected.'),
      change: createReminderSchema.describe('Reminder creation targeting a granted container. Notes are read-only.'),
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
