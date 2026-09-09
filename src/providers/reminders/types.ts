import { z } from 'zod';
import { dateOnlySchema, identifierSchema, instantSchema, timeZoneSchema } from '../../transports/validation.js';

// Date-only and zoned time remain distinct all the way to the native adapter.
export const dueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('date'), date: dateOnlySchema }).strict(),
  z.object({ kind: z.literal('instant'), at: instantSchema, timeZone: timeZoneSchema }).strict(),
]);

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

export interface ReminderWriter {
  // Must establish destination support BEFORE invoking a mutation.
  preflight(input: CreateReminder): Promise<void>;
  create(input: CreateReminder): Promise<ReminderReceipt>;
  verify(receipt: ReminderReceipt, expected: CreateReminder): Promise<boolean>;
}
