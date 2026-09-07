import type { Capability } from '../types.js';

export const notesCapability: Capability = {
  provider: 'notes', backend: 'apple-events', status: 'unavailable', operations: [],
  limitations: [
    'Apple Notes is temporarily disabled in v0.7.0.',
    'Existing grants, audit events, and operation metadata remain readable but do not authorize native access.',
  ],
};
