import type { Capability } from '../types.js';

export const calendarCapability: Capability = {
  provider: 'calendar', backend: 'eventkit-bridge', status: 'available', operations: ['list_calendars', 'list_events', 'create', 'update', 'delete'],
  limitations: [
    'Existing name-based grants are resolved deliberately; an ambiguous or missing target is rejected rather than guessed.',
    'Agent writes require an explicit action grant and a stable idempotency key.',
    'Recurring events and attendee/shared-event management remain unavailable.',
  ],
};
