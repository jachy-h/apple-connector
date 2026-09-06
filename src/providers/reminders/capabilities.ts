import type { Capability } from '../types.js';

export const remindersCapability: Capability = {
  provider: 'reminders', backend: 'apple-events', status: 'available', operations: ['list_lists', 'list', 'create'],
  limitations: [
    'Creation is limited to an explicitly granted list; iCloud may delay visibility after a write.',
    'Reminders scripting dictionary does not expose recurrence or list sharing status.',
    'Existing reminders must not be modified until their supported shape can be established.',
  ],
};
