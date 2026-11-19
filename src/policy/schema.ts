import { z } from 'zod';

export const providerSchema = z.enum(['calendar', 'reminders', 'notes']);
export const grantSchema = z.object({
  provider: providerSchema,
  // `*` grants every current and future container for this provider.
  containerIds: z.array(z.string().min(1).max(512)).min(1).max(100),
  actions: z.array(z.enum(['read', 'create', 'update', 'complete', 'delete'])).min(1).max(5),
  // Epoch milliseconds, matching Date.now(); epoch seconds are rejected by the runtime comparison.
  expiresAt: z.number().int().positive().describe('Unix epoch milliseconds (Date.now() scale); the grant is valid until this time.'),
}).strict().superRefine((grant, context) => {
  if (grant.provider === 'notes' && grant.actions.some((action) => action !== 'read')) {
    context.addIssue({ code: 'custom', message: 'Notes is read-only.' });
  }
});
export type Grant = z.infer<typeof grantSchema>;

export const clientInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  grants: z.array(grantSchema).max(30),
}).strict().superRefine((client, context) => {
  if (client.grants.some((grant) => grant.provider === 'notes')) {
    context.addIssue({ code: 'custom', message: 'Notes is unavailable in v0.8.4 and cannot be granted.' });
  }
});
export type ClientInput = z.infer<typeof clientInputSchema>;

export interface Client {
  id: string;
  name: string;
  grants: Grant[];
  policyVersion: number;
  revoked: boolean;
  lastUsedAt: number | null;
  /** Agent identity recorded by `auth.verify`; null until an Agent completes verification. */
  agentName: string | null;
  verifiedAt: number | null;
}

export type Action = Grant['actions'][number];
