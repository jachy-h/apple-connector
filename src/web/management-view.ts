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
  expiresAt: number;
}

export interface ProfileIdentity { id: string; name: string; revoked: boolean; }
export interface ProfileGroup<T extends ProfileIdentity> { name: string; profiles: T[]; activeCount: number; revokedCount: number; }

export type ProfileAction = ProfileGrant['actions'][number];
export type ProfileProvider = ProfileGrant['provider'];
export interface ContainerPermission {
  selected: boolean;
  actions: ProfileAction[];
}
export interface ContainerSelection {
  containerId: string;
  actions: ProfileAction[];
}

export function profileActions(provider: ProfileProvider): ProfileAction[] {
  return provider === 'calendar' ? ['read', 'create', 'update', 'delete'] : ['read', 'create', 'update', 'complete', 'delete'];
}

/** Format a `datetime-local` value one local calendar year from now, clamping 29 February. */
export function defaultExpiry(now = Date.now()): string {
  const date = new Date(now);
  const day = date.getDate();
  date.setFullYear(date.getFullYear() + 1);
  if (date.getDate() !== day) date.setDate(0);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface ContainerName { id: string; name: string }

/** Index display names by provider and stable ID without changing the persisted grant shape. */
export function buildContainerNameIndex(providers: Partial<Record<ProfileProvider, readonly ContainerName[]>>): Record<string, string> {
  const index: Record<string, string> = {};
  for (const provider of ['calendar', 'reminders'] as const) {
    for (const container of providers[provider] ?? []) index[`${provider}:${container.id}`] = container.name;
  }
  return index;
}

export function containerDisplayName(provider: ProfileProvider, id: string, index: Record<string, string>): string {
  return index[`${provider}:${id}`] ?? id;
}

export function defaultContainerPermission(): ContainerPermission {
  return { selected: false, actions: ['read'] };
}

/** Build one grant per distinct permission combination so identical container settings stay compact. */
export function buildProfileGrants(provider: ProfileProvider, selections: ContainerSelection[], expiresAt: number): ProfileGrant[] {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) throw new Error('Expiry must be a valid time.');
  const allowed = profileActions(provider);
  const groups = new Map<string, ProfileGrant>();
  const seen = new Set<string>();
  for (const selection of selections) {
    if (seen.has(selection.containerId)) continue;
    seen.add(selection.containerId);
    const actions = [...new Set(selection.actions)].sort((left, right) => allowed.indexOf(left) - allowed.indexOf(right));
    if (!actions.length) throw new Error('Each selected container needs at least one action.');
    if (actions.some((action) => !allowed.includes(action))) throw new Error('The selected action is not valid for this provider.');
    const key = actions.join(',');
    const existing = groups.get(key);
    if (existing) existing.containerIds.push(selection.containerId);
    else groups.set(key, { provider, containerIds: [selection.containerId], actions, expiresAt });
  }
  return [...groups.values()];
}

/** Build grants for one authorization that spans both Calendar and Reminders containers. */
export function buildAuthorizationGrants(
  selections: { calendar: ContainerSelection[]; reminders: ContainerSelection[] }, expiresAt: number,
): ProfileGrant[] {
  return [
    ...buildProfileGrants('calendar', selections.calendar, expiresAt),
    ...buildProfileGrants('reminders', selections.reminders, expiresAt),
  ];
}

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

/**
 * macOS has no public API to revoke an already granted TCC permission. The debug flow
 * therefore opens the exact Privacy & Security pane so the maintainer can toggle the
 * permission manually; the page only re-reads the resulting state.
 */
export function permissionSettingsUrl(provider: ProfileGrant['provider']): string {
  return `x-apple.systempreferences:com.apple.preference.security?${provider === 'calendar' ? 'Privacy_Calendars' : 'Privacy_Reminders'}`;
}

export function profileGrant(value: unknown): ProfileGrant | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const grant = value as Record<string, unknown>;
  if ((grant.provider !== 'calendar' && grant.provider !== 'reminders') || !Array.isArray(grant.containerIds) || !Array.isArray(grant.actions)
    || typeof grant.expiresAt !== 'number' || !Number.isSafeInteger(grant.expiresAt)) return undefined;
  const containerIds = grant.containerIds.filter((item): item is string => typeof item === 'string');
  const actions = grant.actions.filter((item): item is ProfileGrant['actions'][number] => ['read', 'create', 'update', 'complete', 'delete'].includes(item as string));
  return containerIds.length === grant.containerIds.length && actions.length === grant.actions.length
    ? { provider: grant.provider, containerIds, actions, expiresAt: grant.expiresAt }
    : undefined;
}

export type AgentBindingTone = 'bound' | 'used' | 'never';
export interface AgentBinding {
  tone: AgentBindingTone;
  agentName: string | null;
  at: number | null;
}

/**
 * Derive how an authorization is bound to an Agent. A verification is explicit; merely using
 * the token (`lastUsedAt`) is shown separately so the page never claims a binding that did not
 * happen.
 */
export function agentBinding(client: { agentName?: unknown; verifiedAt?: unknown; lastUsedAt?: unknown }): AgentBinding {
  const verifiedAt = typeof client.verifiedAt === 'number' && Number.isSafeInteger(client.verifiedAt) && client.verifiedAt > 0 ? client.verifiedAt : null;
  const agentName = typeof client.agentName === 'string' && client.agentName.trim() ? client.agentName.trim() : null;
  if (verifiedAt !== null) return { tone: 'bound', agentName, at: verifiedAt };
  const lastUsedAt = typeof client.lastUsedAt === 'number' && Number.isSafeInteger(client.lastUsedAt) && client.lastUsedAt > 0 ? client.lastUsedAt : null;
  if (lastUsedAt !== null) return { tone: 'used', agentName: null, at: lastUsedAt };
  return { tone: 'never', agentName: null, at: null };
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
