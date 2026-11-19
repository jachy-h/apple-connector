import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

process.on('uncaughtException', (error) => {
  process.stderr.write(`Native build failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

const root = resolve(import.meta.dirname, '..');
const nativeRoot = join(root, 'native');
const buildRoot = join(nativeRoot, '.build', 'release');
const distNative = join(root, 'dist', 'native');
const standaloneHelper = join(distNative, 'apple-connector-helper');
const appPath = join(distNative, 'AppleConnector.app');
const appExecutable = join(appPath, 'Contents', 'MacOS', 'apple-connector-helper');
const localSigningIdentity = (() => {
  try {
    const value = readFileSync(join(root, '.signing-identity'), 'utf8').trim();
    return value || undefined;
  } catch { return undefined; }
})();
const identity = process.env.APPLE_CONNECTOR_SIGN_IDENTITY ?? localSigningIdentity ?? 'Apple Connector Local';
const allowAdhoc = process.env.APPLE_CONNECTOR_ALLOW_ADHOC === '1';
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options });
const capture = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

function signingIdentities() {
  try {
    return run('security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function infoPlist() {
  const usageCalendar = 'Apple Connector reads and writes only the calendar containers you authorize in its local management page.';
  const usageReminders = 'Apple Connector reads and writes only the reminder lists you authorize in its local management page.';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.jachy.apple-connector</string>
  <key>CFBundleName</key><string>Apple Connector</string>
  <key>CFBundleDisplayName</key><string>Apple Connector</string>
  <key>CFBundleExecutable</key><string>apple-connector-helper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSCalendarsFullAccessUsageDescription</key><string>${usageCalendar}</string>
  <key>NSCalendarsUsageDescription</key><string>${usageCalendar}</string>
  <key>NSRemindersFullAccessUsageDescription</key><string>${usageReminders}</string>
  <key>NSRemindersUsageDescription</key><string>${usageReminders}</string>
</dict>
</plist>
`;
}

function sign(target, identifier, adhoc) {
  const signWith = adhoc ? '-' : identity;
  const result = spawnSync('codesign', ['--force', '--timestamp=none', '--identifier', identifier, '--sign', signWith, target], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`codesign failed for ${target}:\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
}

function requireStableSignature(target) {
  const details = capture('codesign', ['-dv', '--verbose=4', target]).output;
  const requirement = capture('codesign', ['-d', '-r-', target]).output;
  if (!/Identifier=com\.jachy\.apple-connector\b/.test(details)) {
    throw new Error(`Signed App has an unexpected identifier:\n${details}`);
  }
  if (/Signature=adhoc/.test(details)) {
    throw new Error(`Signed App is still ad-hoc:\n${details}`);
  }
  if (!/certificate/i.test(requirement) || /cdhash/i.test(requirement)) {
    throw new Error(`Signed App designated requirement is not stable:\n${requirement}`);
  }
  process.stdout.write(`Designated requirement: ${requirement.trim()}\n`);
}

process.stdout.write('Building native helper…\n');
run('swift', ['build', '-c', 'release', '--package-path', nativeRoot], {
  env: { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? '/Applications/Xcode.app/Contents/Developer' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

if (!existsSync(join(buildRoot, 'apple-connector-helper'))) {
  throw new Error('Swift build did not produce apple-connector-helper.');
}

const hasIdentity = signingIdentities().includes(`"${identity}"`);
if (!hasIdentity && !allowAdhoc) {
  throw new Error(
    `Code-signing identity "${identity}" was not found.\n` +
      'Create it once in Keychain Access (Certificate Assistant → Create a Certificate → Self Signed Root → Code Signing), ' +
      'or set APPLE_CONNECTOR_SIGN_IDENTITY to an existing code-signing identity.\n' +
      'For CI or throwaway test builds only, set APPLE_CONNECTOR_ALLOW_ADHOC=1.',
  );
}

rmSync(distNative, { recursive: true, force: true });
mkdirSync(join(appPath, 'Contents', 'MacOS'), { recursive: true });

cpSync(join(buildRoot, 'apple-connector-helper'), standaloneHelper);
chmodSync(standaloneHelper, 0o755);
cpSync(join(buildRoot, 'apple-connector-helper'), appExecutable);
chmodSync(appExecutable, 0o755);
writeFileSync(join(appPath, 'Contents', 'Info.plist'), infoPlist());

if (hasIdentity) {
  sign(standaloneHelper, 'com.jachy.apple-connector.helper', false);
  sign(appPath, 'com.jachy.apple-connector', false);
  requireStableSignature(appPath);
  process.stdout.write(`Signed AppleConnector.app with "${identity}" (version ${version}).\n`);
} else {
  sign(standaloneHelper, 'com.jachy.apple-connector.helper', true);
  sign(appPath, 'com.jachy.apple-connector', true);
  process.stderr.write(
    'WARNING: APPLE_CONNECTOR_ALLOW_ADHOC=1 is set. The App is ad-hoc signed.\n' +
      'macOS will forget Calendar/Reminders permission whenever this App changes.\n' +
      'Never publish or install a build signed this way.\n',
  );
}

const verify = spawnSync('codesign', ['--verify', '--strict', '--verbose=2', appPath], { cwd: root, encoding: 'utf8' });
if (verify.status !== 0) throw new Error(`codesign --verify failed:\n${verify.stdout ?? ''}${verify.stderr ?? ''}`);
process.stdout.write(`Built ${appPath}\n`);
