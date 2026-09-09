import type { Capability } from '../types.js';

export const notesCapability: Capability = {
  provider: 'notes', backend: 'apple-events', status: 'unavailable', operations: [],
  limitations: [
    'Apple Notes is disabled in v0.8.4.',
    'Existing grants, audit events, and operation metadata remain readable but do not authorize native access.',
  ],
};
