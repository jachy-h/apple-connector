import { z } from 'zod';

export const createNoteSchema = z.object({
  kind: z.literal('notes.create'),
  containerId: z.string().min(1).max(512),
  // v0.1.0 creates simple plaintext notes only; the adapter escapes it before constructing HTML.
  title: z.string().trim().min(1).max(500),
  body: z.string().max(32_000).default(''),
}).strict();
export type CreateNote = z.infer<typeof createNoteSchema>;

export const noteReceiptSchema = z.object({ id: z.string().min(1).max(512), containerId: z.string().min(1).max(512) }).strict();
export type NoteReceipt = z.infer<typeof noteReceiptSchema>;

export interface NoteWriter {
  preflight(input: CreateNote): Promise<void>;
  create(input: CreateNote): Promise<NoteReceipt>;
  verify(receipt: NoteReceipt, expected: CreateNote): Promise<boolean>;
}
