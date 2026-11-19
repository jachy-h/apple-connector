import { fileURLToPath } from 'node:url';

/** Standalone helper used by tests, direct mode and the bundled App. */
export function helperExecutablePath(): string {
  return fileURLToPath(new URL('../../native/apple-connector-helper', import.meta.url));
}

/** Self-signed App bundle that owns the macOS Calendar/Reminders permission. */
export function helperAppPath(): string {
  return fileURLToPath(new URL('../../native/AppleConnector.app', import.meta.url));
}
