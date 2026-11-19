import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const localIdentity = (() => {
  try {
    return readFileSync(resolve(root, '.signing-identity'), 'utf8').trim() || undefined;
  } catch { return undefined; }
})();
const identity = process.env.APPLE_CONNECTOR_SIGN_IDENTITY ?? localIdentity ?? 'Apple Connector Local';
let output = '';
try {
  output = execFileSync('security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch {
  output = '';
}

process.stdout.write(`Code-signing identity: ${identity}${process.env.APPLE_CONNECTOR_SIGN_IDENTITY ? ' (from APPLE_CONNECTOR_SIGN_IDENTITY)' : localIdentity ? ' (from .signing-identity)' : ''}\n`);
if (output.includes(`"${identity}"`)) {
  process.stdout.write('Status: found\n');
  process.exit(0);
}

process.stderr.write(`Status: missing

Create it once in Keychain Access:
  1. Keychain Access → Certificate Assistant → Create a Certificate…
  2. Name: ${identity}
  3. Identity Type: Self Signed Root
  4. Certificate Type: Code Signing
  5. Validity: 3650 days
  6. Create, then (optional) set Trust → Code Signing → Always Trust for this Mac.

Or set APPLE_CONNECTOR_SIGN_IDENTITY to an existing code-signing identity, or write it to .signing-identity.
See docs/signing.md (English) or docs/signing_zh.md (中文).
`);
process.exit(1);
