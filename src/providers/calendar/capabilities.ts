import type { Capability } from '../types.js';

export const calendarCapability: Capability = {
  provider: 'calendar', backend: 'eventkit-bridge', status: 'available', operations: ['list_calendars', 'list_events', 'web_create', 'web_update', 'web_delete'],
  limitations: [
    'Existing name-based grants are resolved deliberately; an ambiguous or missing target is rejected rather than guessed.',
    'Calendar changes are available only through the authenticated local management webpage, never through MCP.',
    'Recurring events and attendee/shared-event management remain unavailable.',
  ],
};
