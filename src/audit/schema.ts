import { z } from 'zod';
import { providerSchema } from '../policy/schema.js';

export const auditEventSchema = z.object({
  at: z.number().int().nonnegative(),
  clientId: z.string().max(128),
  operationId: z.string().max(128).optional(),
  provider: providerSchema.optional(),
  action: z.enum(['read', 'create', 'update', 'complete', 'client_created', 'client_revoked', 'approved', 'denied']),
  outcome: z.enum(['allowed', 'denied', 'succeeded', 'failed', 'outcome_unknown']),
  count: z.number().int().nonnegative().max(1000).default(0),
  policyVersion: z.number().int().nonnegative().optional(),
  errorCode: z.enum(['permission_denied', 'conflict', 'timeout', 'outcome_unknown', 'service_unavailable', 'approval_required']).optional(),
}).strict();
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const defaultRetention = { days: 30, maxRows: 20_000, maxBytes: 50 * 1024 * 1024 };
