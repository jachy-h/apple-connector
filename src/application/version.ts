import { readFileSync } from 'node:fs';

export const appVersion = ((): string => {
  const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
})();