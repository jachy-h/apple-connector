export const hiddenAuditLanesStorageKey = 'apple-connector.audit.hidden-lanes';

const laneKey = /^(web|client:[A-Za-z0-9._:-]{1,128})$/;

/** Hidden lanes are a per-browser view preference; they never delete server audit data. */
export interface AuditPreferenceReader { getItem(key: string): string | null }
export interface AuditPreferenceWriter { setItem(key: string, value: string): void }

export function readHiddenAuditLanes(storage: AuditPreferenceReader | undefined): string[] {
  try {
    const raw = storage?.getItem(hiddenAuditLanesStorageKey);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((item): item is string => typeof item === 'string' && laneKey.test(item)))].slice(0, 200);
  } catch {
    return [];
  }
}

export function saveHiddenAuditLanes(storage: AuditPreferenceWriter | undefined, lanes: readonly string[]): void {
  try {
    const unique = [...new Set(lanes.filter((item) => laneKey.test(item)))].slice(0, 200);
    storage?.setItem(hiddenAuditLanesStorageKey, JSON.stringify(unique));
  } catch {
    /* A blocked storage preference must not prevent management access. */
  }
}

export function toggleHiddenAuditLane(current: readonly string[], key: string): string[] {
  return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
}
