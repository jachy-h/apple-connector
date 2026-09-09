import { z } from 'zod';
import { identifierSchema, instantSchema } from '../../transports/validation.js';

const eventFields = {
  containerId: identifierSchema(),
  title: z.string().trim().min(1).max(500),
  start: instantSchema,
  end: instantSchema,
  allDay: z.boolean(),
  location: z.string().max(2_000).default(''),
  notes: z.string().max(32_000).default(''),
};
const validRange = <T extends z.ZodTypeAny>(schema: T) => schema.superRefine((value: z.infer<T>, context) => {
  const fields = value as { start: string; end: string };
  if (Date.parse(fields.end) <= Date.parse(fields.start)) context.addIssue({ code: 'custom', message: 'Invalid arguments "start" and "end": "end" must be later than "start".' });
});

export const createCalendarEventSchema = validRange(z.object({ kind: z.literal('calendar.create'), ...eventFields }).strict());
export type CreateCalendarEvent = z.infer<typeof createCalendarEventSchema>;
export const updateCalendarEventSchema = validRange(z.object({ kind: z.literal('calendar.update'), id: identifierSchema(), ...eventFields }).strict());
export type UpdateCalendarEvent = z.infer<typeof updateCalendarEventSchema>;
export const deleteCalendarEventSchema = z.object({ kind: z.literal('calendar.delete'), containerId: identifierSchema(), id: identifierSchema() }).strict();
export type DeleteCalendarEvent = z.infer<typeof deleteCalendarEventSchema>;
export const calendarEventReceiptSchema = z.object({ id: z.string().min(1).max(512), containerId: z.string().min(1).max(512) }).strict();
export type CalendarEventReceipt = z.infer<typeof calendarEventReceiptSchema>;

export interface CalendarWriter {
  create(input: CreateCalendarEvent): Promise<CalendarEventReceipt>;
  update(input: UpdateCalendarEvent): Promise<CalendarEventReceipt>;
  remove(input: DeleteCalendarEvent): Promise<CalendarEventReceipt>;
}
