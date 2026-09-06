import type { Capability } from '../types.js';

export const notesCapability: Capability = {
  provider: 'notes', backend: 'apple-events', status: 'available', operations: ['list_folders', 'get', 'search', 'create'],
  limitations: [
    'Reads are limited to explicitly granted non-shared folders; locked and shared notes are excluded.',
    'Creation is limited to explicitly granted non-shared folders; existing-note edits are excluded.',
  ],
};
