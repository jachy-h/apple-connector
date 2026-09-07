import { z } from 'zod';

export const providerSchema = z.enum(['calendar', 'reminders', 'notes']);
export const grantSchema = z.object({
  provider: providerSchema,
  containerIds: z.array(z.string().min(1).max(512)).min(1).max(100),
  actions: z.array(z.enum(['read', 'create', 'update', 'complete'])).min(1).max(4),
  fields: z.enum(['full', 'busy']).default('full'),
  approval: z.enum(['automatic', 'required']).default('required'),
  // Epoch milliseconds, matching Date.now(); epoch seconds are rejected by the runtime comparison.
  expiresAt: z.number().int().positive().describe('Unix epoch milliseconds (Date.now() scale); the grant is valid until this time.'),
}).strict().superRefine((grant, context) => {
  if (grant.fields === 'busy' && (grant.provider !== 'calendar' || grant.actions.some((action) => action !== 'read'))) {
    context.addIssue({ code: 'custom', message: 'Busy grants are calendar read-only.' });
  }
  if (grant.provider === 'notes' && grant.actions.some((action) => action !== 'read')) {
    context.addIssue({ code: 'custom', message: 'Notes is read-only.' });
  }
});
export type Grant = z.infer<typeof grantSchema>;

export const clientInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  grants: z.array(grantSchema).max(30),
}).strict();
export type ClientInput = z.infer<typeof clientInputSchema>;

export interface Client {
  id: string;
  name: string;
  grants: Grant[];
  policyVersion: number;
  revoked: boolean;
}

export type Action = Grant['actions'][number];
