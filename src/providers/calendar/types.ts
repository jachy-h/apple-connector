import { z } from 'zod';

const eventFields = {
  containerId: z.string().min(1).max(512),
  title: z.string().trim().min(1).max(500),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  allDay: z.boolean(),
  location: z.string().max(2_000).default(''),
  notes: z.string().max(32_000).default(''),
};
const validRange = <T extends z.ZodTypeAny>(schema: T) => schema.superRefine((value: z.infer<T>, context) => {
  const fields = value as { start: string; end: string };
  if (Date.parse(fields.end) <= Date.parse(fields.start)) context.addIssue({ code: 'custom', message: 'Event end must be after its start.' });
});

export const createCalendarEventSchema = validRange(z.object({ kind: z.literal('calendar.create'), ...eventFields }).strict());
export type CreateCalendarEvent = z.infer<typeof createCalendarEventSchema>;
export const updateCalendarEventSchema = validRange(z.object({ kind: z.literal('calendar.update'), id: z.string().min(1).max(512), ...eventFields }).strict());
export type UpdateCalendarEvent = z.infer<typeof updateCalendarEventSchema>;
export const deleteCalendarEventSchema = z.object({ kind: z.literal('calendar.delete'), containerId: z.string().min(1).max(512), id: z.string().min(1).max(512) }).strict();
export type DeleteCalendarEvent = z.infer<typeof deleteCalendarEventSchema>;
export const calendarEventReceiptSchema = z.object({ id: z.string().min(1).max(512), containerId: z.string().min(1).max(512) }).strict();
export type CalendarEventReceipt = z.infer<typeof calendarEventReceiptSchema>;

export interface CalendarWriter {
  create(input: CreateCalendarEvent): Promise<CalendarEventReceipt>;
  update(input: UpdateCalendarEvent): Promise<CalendarEventReceipt>;
  remove(input: DeleteCalendarEvent): Promise<CalendarEventReceipt>;
}
