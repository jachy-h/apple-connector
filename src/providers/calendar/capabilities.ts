import type { Capability } from '../types.js';

export const calendarCapability: Capability = {
  provider: 'calendar', backend: 'apple-events', status: 'available', operations: ['list_calendars', 'list_events'],
  limitations: [
    'Read scopes are exact calendar names; a missing or duplicate name is rejected rather than guessed.',
    'Calendar scripting does not expose a stable calendar UID or definitive sharing state.',
    'Writes, recurring events and attendee/shared-event management remain unavailable.',
  ],
};
