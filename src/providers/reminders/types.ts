import { z } from 'zod';
import { dateOnlySchema, identifierSchema, instantSchema, timeZoneSchema } from '../../transports/validation.js';

const timeOfDaySchema = z.string().regex(
  /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
  'expected a 24-hour time, for example "17:00" or "17:00:00".',
);

// Date-only, floating wall-clock and zoned time remain distinct all the way to the
// native adapter and back. A nil EventKit time zone is a floating due, not an instant.
export const dueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('date'), date: dateOnlySchema }).strict(),
  z.object({ kind: z.literal('floating'), date: dateOnlySchema, time: timeOfDaySchema }).strict(),
  z.object({ kind: z.literal('instant'), at: instantSchema, timeZone: timeZoneSchema }).strict(),
]);
export type Due = z.infer<typeof dueSchema>;

export const createReminderSchema = z.object({
  kind: z.literal('reminders.create'),
  containerId: identifierSchema(),
  title: z.string().trim().min(1).max(500),
  body: z.string().max(32_000).default(''),
  due: dueSchema.optional(),
}).strict();
export type CreateReminder = z.infer<typeof createReminderSchema>;
export const updateReminderSchema = z.object({
  kind: z.literal('reminders.update'),
  containerId: identifierSchema(),
  id: identifierSchema(),
  title: z.string().trim().min(1).max(500),
  body: z.string().max(32_000).default(''),
  completed: z.boolean(),
}).strict();
export type UpdateReminder = z.infer<typeof updateReminderSchema>;
export const patchReminderSchema = z.object({
  kind: z.literal('reminders.patch'),
  containerId: identifierSchema(),
  id: identifierSchema(),
  title: z.string().trim().min(1).max(500).optional(),
  body: z.string().max(32_000).optional(),
  due: dueSchema.nullable().optional(),
  completed: z.boolean().optional(),
}).strict().refine(
  (value) => value.title !== undefined || value.body !== undefined || value.due !== undefined || value.completed !== undefined,
  { message: 'at least one reminder field must be changed.' },
);
export type PatchReminder = z.infer<typeof patchReminderSchema>;
export const deleteReminderSchema = z.object({
  kind: z.literal('reminders.delete'),
  containerId: identifierSchema(),
  id: identifierSchema(),
}).strict();
export type DeleteReminder = z.infer<typeof deleteReminderSchema>;
export const completeReminderSchema = z.object({
  kind: z.literal('reminders.complete'),
  containerId: identifierSchema(),
  id: identifierSchema(),
}).strict();
export type CompleteReminder = z.infer<typeof completeReminderSchema>;
export const reminderReceiptSchema = z.object({ id: z.string().min(1).max(512), containerId: z.string().min(1).max(512) }).strict();
export type ReminderReceipt = z.infer<typeof reminderReceiptSchema>;

export interface ReminderList { id: string; name: string }

export const reminderItemSchema = z.object({
  id: z.string().min(1).max(512),
  listId: z.string().min(1).max(512),
  // Reads must not reject existing Apple data that is longer than the write limits.
  title: z.string().max(10_000),
  body: z.string().max(200_000),
  completed: z.boolean(),
  due: dueSchema.nullable(),
  recurring: z.boolean(),
}).strict();
export type ReminderItem = z.infer<typeof reminderItemSchema>;
export const reminderPageSchema = z.object({
  items: z.array(reminderItemSchema),
  nextOffset: z.number().int().min(0).nullable(),
}).strict();
export type ReminderPage = z.infer<typeof reminderPageSchema>;

export interface ReminderWriter {
  // Must establish destination support BEFORE invoking a mutation.
  preflight(input: CreateReminder): Promise<void>;
  create(input: CreateReminder): Promise<ReminderReceipt>;
  verify(receipt: ReminderReceipt, expected: CreateReminder): Promise<boolean>;
}
