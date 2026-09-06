import { ConnectorError } from '../application/errors.js';
import type { ProviderId } from '../providers/types.js';
import type { Action, Client, Grant } from './schema.js';

export function authorize(
  client: Client, provider: ProviderId, containerId: string, action: Action, now = Date.now(),
): Grant {
  if (client.revoked) throw new ConnectorError('permission_denied', 'Client access has been revoked.');
  const matches = client.grants.filter((grant) =>
    grant.provider === provider && grant.containerIds.includes(containerId) &&
    grant.actions.includes(action) && grant.expiresAt > now);
  if (!matches.length) throw new ConnectorError('permission_denied', 'Operation is outside the granted scope.');
  // Overlap cannot accidentally relax a busy-only or approval-required restriction.
  return {
    ...matches[0]!,
    approval: matches.some((grant) => grant.approval === 'required') ? 'required' : 'automatic',
    fields: matches.some((grant) => grant.fields === 'busy') ? 'busy' : 'full',
    expiresAt: Math.min(...matches.map((grant) => grant.expiresAt)),
  };
}

export function projectCalendarEvent(event: object, fields: Grant['fields']): Record<string, unknown> {
  const record = event as Record<string, unknown>;
  if (fields === 'full') return { ...record };
  // Allowlist protects future fields (e.g. conferencing URLs) by default.
  return Object.fromEntries(['start', 'end', 'allDay', 'timeZone']
    .filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]));
}
