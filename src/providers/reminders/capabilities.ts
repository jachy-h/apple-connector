import type { Capability } from '../types.js';

export const remindersCapability: Capability = {
  provider: 'reminders', backend: 'eventkit-bridge', status: 'available', operations: ['list_lists', 'list', 'create', 'update', 'complete', 'delete'],
  limitations: [
    'Writes are limited to explicitly granted lists; iCloud may delay visibility after a write.',
    'EventKit IDs are local to the current macOS data-store context and may change after an account reset.',
    'Recurring reminders cannot be edited or deleted.',
  ],
};
