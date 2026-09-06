import { appendFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';

export const MAX_LOG_BYTES = 5 * 1024 * 1024;
export const MAX_LOG_FILES = 3;
export const MAX_LOG_AGE_MS = 7 * 86_400_000;

function archivedPath(path: string, index: number): string { return `${path}.${index}`; }

/** Append one service line while enforcing three files, 5 MiB each, and a seven-day age limit. */
export function appendServiceLog(path: string, message: string, now = Date.now()): void {
  try {
    for (let index = 0; index < MAX_LOG_FILES; index++) {
      const candidate = index === 0 ? path : archivedPath(path, index);
      try {
        if (now - statSync(candidate).mtimeMs > MAX_LOG_AGE_MS) rmSync(candidate, { force: true });
      } catch { /* Missing/unreadable logs do not affect service availability. */ }
    }

    const line = `${new Date(now).toISOString()} ${message}\n`;
    const incomingBytes = Buffer.byteLength(line);
    let currentBytes = 0;
    try { currentBytes = statSync(path).size; } catch { /* First log line. */ }
    if (currentBytes > 0 && currentBytes + incomingBytes > MAX_LOG_BYTES) {
      rmSync(archivedPath(path, MAX_LOG_FILES - 1), { force: true });
      for (let index = MAX_LOG_FILES - 2; index >= 1; index--) {
        const source = archivedPath(path, index);
        if (existsSync(source)) renameSync(source, archivedPath(path, index + 1));
      }
      renameSync(path, archivedPath(path, 1));
    }
    appendFileSync(path, line, { mode: 0o600 });
  } catch { /* Logging must never take the service down. */ }
}
