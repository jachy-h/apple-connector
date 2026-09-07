import { z } from 'zod';
import { providerSchema } from '../policy/schema.js';

export const auditEventSchema = z.object({
  at: z.number().int().nonnegative(),
  // Web debugging is authenticated by the loopback management session, not an MCP client.
  // Keep clientId optional so old client-origin records remain fully compatible.
  clientId: z.string().max(128).optional(),
  source: z.enum(['client', 'web']).default('client'),
  operationId: z.string().max(128).optional(),
  provider: providerSchema.optional(),
  target: z.string().max(512).optional(),
  durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
  action: z.enum(['read', 'create', 'update', 'delete', 'complete', 'client_created', 'client_updated', 'client_token_rotated', 'client_revoked', 'approved', 'operation_rejected', 'denied']),
  outcome: z.enum(['allowed', 'denied', 'succeeded', 'failed', 'outcome_unknown']),
  count: z.number().int().nonnegative().max(1000).default(0),
  policyVersion: z.number().int().nonnegative().optional(),
  errorCode: z.enum(['invalid_request', 'permission_denied', 'ambiguous_target', 'conflict', 'unsupported_operation', 'timeout', 'outcome_unknown', 'protocol_error', 'service_unavailable', 'approval_required']).optional(),
}).strict();
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const defaultRetention = { days: 30, maxRows: 20_000, maxBytes: 50 * 1024 * 1024 };
