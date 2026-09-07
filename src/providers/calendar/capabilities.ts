import type { Capability } from '../types.js';

export const calendarCapability: Capability = {
  provider: 'calendar', backend: 'eventkit-bridge', status: 'available', operations: ['list_calendars', 'list_events'],
  limitations: [
    'Existing name-based grants are resolved deliberately; an ambiguous or missing target is rejected rather than guessed.',
    'Calendar writes, shared-event management and recurrence mutation remain unavailable.',
    'Writes, recurring events and attendee/shared-event management remain unavailable.',
  ],
};
