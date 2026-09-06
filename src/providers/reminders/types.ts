import { z } from 'zod';

// Date-only and zoned time remain distinct all the way to the native adapter.
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
export const dueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('date'), date: dateOnly }).strict(),
  z.object({ kind: z.literal('instant'), at: z.iso.datetime({ offset: true }), timeZone: z.string().refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'Invalid time zone') }).strict(),
]);

export const createReminderSchema = z.object({
  kind: z.literal('reminders.create'),
  containerId: z.string().min(1).max(512),
  title: z.string().trim().min(1).max(500),
  body: z.string().max(32_000).default(''),
  due: dueSchema.optional(),
}).strict();
export type CreateReminder = z.infer<typeof createReminderSchema>;
export const reminderReceiptSchema = z.object({ id: z.string().min(1).max(512), containerId: z.string().min(1).max(512) }).strict();
export type ReminderReceipt = z.infer<typeof reminderReceiptSchema>;

export interface ReminderWriter {
  // Must establish destination support BEFORE invoking a mutation.
  preflight(input: CreateReminder): Promise<void>;
  create(input: CreateReminder): Promise<ReminderReceipt>;
  verify(receipt: ReminderReceipt, expected: CreateReminder): Promise<boolean>;
}
