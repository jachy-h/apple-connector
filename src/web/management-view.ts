export type PermissionTone = 'granted' | 'warning' | 'denied' | 'unknown';

export interface PermissionState {
  raw: string;
  tone: PermissionTone;
  statusKey: 'fullAccess' | 'writeOnly' | 'denied' | 'restricted' | 'notDetermined' | 'unknown' | 'unavailable';
}

export interface ProfileGrant {
  provider: 'calendar' | 'reminders';
  containerIds: string[];
  actions: Array<'read' | 'create' | 'update' | 'complete' | 'delete'>;
  fields: 'full' | 'busy';
  approval: 'automatic' | 'required';
  expiresAt: number;
}

export interface ProfileIdentity { id: string; name: string; revoked: boolean; }
export interface ProfileGroup<T extends ProfileIdentity> { name: string; profiles: T[]; activeCount: number; revokedCount: number; }

export function permissionState(value: unknown): PermissionState {
  const raw = typeof value === 'string' ? value : 'unavailable';
  switch (raw) {
    case 'full_access': return { raw, tone: 'granted', statusKey: 'fullAccess' };
    case 'write_only': return { raw, tone: 'warning', statusKey: 'writeOnly' };
    case 'denied': return { raw, tone: 'denied', statusKey: 'denied' };
    case 'restricted': return { raw, tone: 'denied', statusKey: 'restricted' };
    case 'not_determined': return { raw, tone: 'warning', statusKey: 'notDetermined' };
    case 'unknown': return { raw, tone: 'unknown', statusKey: 'unknown' };
    default: return { raw, tone: 'unknown', statusKey: 'unavailable' };
  }
}

export function profileGrant(value: unknown): ProfileGrant | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const grant = value as Record<string, unknown>;
  if ((grant.provider !== 'calendar' && grant.provider !== 'reminders') || !Array.isArray(grant.containerIds) || !Array.isArray(grant.actions)
    || (grant.fields !== 'full' && grant.fields !== 'busy') || (grant.approval !== 'automatic' && grant.approval !== 'required') || typeof grant.expiresAt !== 'number' || !Number.isSafeInteger(grant.expiresAt)) return undefined;
  const containerIds = grant.containerIds.filter((item): item is string => typeof item === 'string');
  const actions = grant.actions.filter((item): item is ProfileGrant['actions'][number] => ['read', 'create', 'update', 'complete', 'delete'].includes(item as string));
  return containerIds.length === grant.containerIds.length && actions.length === grant.actions.length
    ? { provider: grant.provider, containerIds, actions, fields: grant.fields, approval: grant.approval, expiresAt: grant.expiresAt }
    : undefined;
}

/** UI-only grouping: a name is not a security identity, so every client remains visible and actionable. */
export function groupProfiles<T extends ProfileIdentity>(profiles: T[]): ProfileGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const profile of profiles) {
    const name = profile.name.trim() || profile.id;
    const existing = groups.get(name);
    if (existing) existing.push(profile); else groups.set(name, [profile]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, members]) => {
    const sorted = [...members].sort((left, right) => Number(left.revoked) - Number(right.revoked) || left.id.localeCompare(right.id));
    return { name, profiles: sorted, activeCount: sorted.filter((profile) => !profile.revoked).length, revokedCount: sorted.filter((profile) => profile.revoked).length };
  });
}
