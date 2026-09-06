import { calendarCapability } from '../providers/calendar/capabilities.js';
import { remindersCapability } from '../providers/reminders/capabilities.js';
import { notesCapability } from '../providers/notes/capabilities.js';

export function capabilities() {
  return structuredClone([calendarCapability, remindersCapability, notesCapability]);
}
