import { z } from 'zod';

const isoWithOffset = z.iso.datetime({ offset: true });

/** Shared public input contracts. Keep messages useful without reflecting caller data. */
export const identifierSchema = (max = 512) => z.string().trim().min(1, 'must be a non-empty string.').max(max, `must be at most ${max} characters.`);
export const idempotencyKeySchema = z.string().min(1, 'must be a non-empty string.').max(128, 'must be at most 128 characters.');
export const offsetSchema = z.number().int('must be an integer.').min(0, 'must be greater than or equal to 0.');
export const limitSchema = z.number().int('must be an integer.').min(1, 'must be at least 1.').max(100, 'must be at most 100.');
export const instantSchema = z.string().refine((value) => isoWithOffset.safeParse(value).success, {
  message: 'expected an RFC 3339 datetime with an explicit timezone, for example "2026-09-07T00:00:00+08:00" or "2026-09-06T16:00:00Z"; fractional seconds are optional.',
});
export const dateOnlySchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, { message: 'expected a valid YYYY-MM-DD date, for example "2026-09-07".' });
export const timeZoneSchema = z.string().refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, { message: 'expected a valid IANA timezone, for example "Asia/Shanghai".' });

export const calendarListEventsSchema = z.object({
  calendarId: identifierSchema(), from: instantSchema, to: instantSchema,
  offset: offsetSchema.default(0), limit: limitSchema.default(50),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.to) <= Date.parse(value.from)) context.addIssue({
    code: 'custom', message: 'Invalid arguments "from" and "to": "to" must be later than "from".',
  });
});

export const remindersListSchema = z.object({ listId: identifierSchema(), offset: offsetSchema.default(0), limit: limitSchema.default(50) }).strict();
export const operationRefSchema = z.object({ id: identifierSchema(128) }).strict();
export const mutationRequestSchema = <T extends z.ZodType>(change: T) => z.object({ idempotencyKey: idempotencyKeySchema, change }).strict();

export function validationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request parameters.';
  if (issue.message.startsWith('Invalid arguments ')) return issue.message;
  const path = issue.path.length ? issue.path.map(String).join('.') : 'parameters';
  return `Invalid argument "${path}": ${issue.message}`;
}
