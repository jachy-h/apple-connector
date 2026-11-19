import type { Capability } from '../types.js';

export const remindersCapability: Capability = {
  provider: 'reminders', backend: 'eventkit-bridge', status: 'available', operations: ['list_lists', 'list', 'create', 'update', 'patch', 'complete', 'delete'],
  limitations: [
    'Writes are limited to explicitly granted lists; iCloud may delay visibility after a write.',
    'EventKit IDs are local to the current macOS data-store context. Normal edits keep them stable, but a full sync, account reset or data-store rebuild can invalidate them; re-resolve by listing instead of treating a missing ID as a deletion.',
    'Recurring reminders cannot be patched, edited, completed or deleted.',
    'Due dates distinguish date-only, floating wall-clock and zoned instants. A floating due has no time zone; a zoned instant round-trips its IANA time zone on the same local store.',
  ],
};
