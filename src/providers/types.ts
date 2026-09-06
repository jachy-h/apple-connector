export type ProviderId = 'calendar' | 'reminders' | 'notes';
export interface Capability {
  provider: ProviderId;
  backend: 'apple-events' | 'eventkit-bridge' | 'undecided';
  status: 'unverified' | 'available' | 'unavailable';
  operations: string[];
  limitations: string[];
}
