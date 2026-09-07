import type { Capability } from '../types.js';

export const remindersCapability: Capability = {
  provider: 'reminders', backend: 'eventkit-bridge', status: 'available', operations: ['list_lists', 'list', 'create'],
  limitations: [
    'Creation is limited to an explicitly granted list; iCloud may delay visibility after a write.',
    'EventKit IDs are local to the current macOS data-store context and may change after an account reset.',
    'Existing reminders must not be modified until their supported shape can be established.',
  ],
};
