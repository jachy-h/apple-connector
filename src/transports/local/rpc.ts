import { z } from 'zod';
import { ConnectorError, publicError } from '../../application/errors.js';
import type { ErrorCode } from '../../application/errors.js';

export const rpcMethodSchema = z.enum([
  'capabilities',
  'calendar.list_calendars', 'calendar.list_events',
  'reminders.list_lists',
  'reminders.list',
  'notes.list_folders', 'notes.get', 'notes.search',
  'operations.prepare', 'operations.commit', 'operations.get',
  'clients.list', 'clients.create', 'clients.revoke',
  'operations.approve',
  'audit.list', 'audit.summary', 'audit.clear', 'operations.list',
]);
export type RpcMethod = z.infer<typeof rpcMethodSchema>;

export const rpcEnvelopeSchema = z.object({
  method: rpcMethodSchema,
  params: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type RpcEnvelope = z.infer<typeof rpcEnvelopeSchema>;

export interface RpcOk { ok: true; result: unknown }
export interface RpcError { ok: false; error: { code: ErrorCode; message: string } }
export type RpcResponse = RpcOk | RpcError;

export const rpcOk = (result: unknown): RpcOk => ({ ok: true, result });
export const rpcFail = (error: unknown): RpcError => {
  if (error instanceof ConnectorError) return { ok: false, error: publicError(error) };
  return { ok: false, error: publicError(error) };
};

/** Agent-facing methods; never expose admin methods through an agent transport. */
export const agentMethods = new Set<RpcMethod>(['capabilities', 'calendar.list_calendars', 'calendar.list_events', 'reminders.list_lists', 'reminders.list', 'notes.list_folders', 'notes.get', 'notes.search', 'operations.prepare', 'operations.commit', 'operations.get']);
/** Management methods; require a trusted local admin session. */
export const adminMethods = new Set<RpcMethod>(['clients.list', 'clients.create', 'clients.revoke', 'operations.approve', 'audit.list', 'audit.summary', 'audit.clear', 'operations.list']);
