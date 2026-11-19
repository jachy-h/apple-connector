import { ConnectorError } from '../application/errors.js';
import type { ProviderId } from '../providers/types.js';
import type { Action, Client, Grant } from './schema.js';

export function authorize(
  client: Client, provider: ProviderId, containerId: string, action: Action, now = Date.now(),
): Grant {
  if (client.revoked) throw new ConnectorError('permission_denied', 'Client access has been revoked.');
  const matches = client.grants.filter((grant) =>
    grant.provider === provider && (grant.containerIds.includes(containerId) || grant.containerIds.includes('*')) &&
    grant.actions.includes(action) && grant.expiresAt > now);
  if (!matches.length) throw new ConnectorError('permission_denied', 'Operation is outside the granted scope.');
  return {
    ...matches[0]!,
    expiresAt: Math.min(...matches.map((grant) => grant.expiresAt)),
  };
}
