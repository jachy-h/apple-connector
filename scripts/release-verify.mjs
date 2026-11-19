import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const requireFile = (path) => {
  if (!existsSync(resolve(root, path))) throw new Error(`Release artifact is missing: ${path}`);
};

run('npm', ['run', 'check']);
requireFile('dist/src/cli/index.js');
requireFile('dist/web/index.html');
requireFile('dist/native/apple-connector-helper');
requireFile('dist/native/AppleConnector.app/Contents/Info.plist');
requireFile('dist/native/AppleConnector.app/Contents/MacOS/apple-connector-helper');
requireFile('LICENSE');
requireFile('scripts/jxa/notes/read.js');
requireFile('scripts/jxa/reminders/read.js');
requireFile('scripts/jxa/reminders/write.js');
requireFile('scripts/jxa/calendar/read.js');
if (statSync(resolve(root, 'dist/web/index.html')).size < 100) throw new Error('Management UI build output is unexpectedly small.');
run(process.execPath, ['dist/src/cli/index.js', '--help']);
run(process.execPath, ['dist/src/cli/index.js', 'help']);
run(process.execPath, ['dist/src/cli/index.js', 'help', 'calendar', 'create']);
run(process.execPath, ['dist/src/cli/index.js', 'version']);
run(process.execPath, ['dist/src/cli/index.js', 'doctor']);
run('npm', ['ls', '--omit=dev', '--all']);
const { scriptRegistry } = await import('../dist/src/jxa/protocol.js');
for (const registration of Object.values(scriptRegistry)) requireFile(`scripts/jxa/${registration.path}`);
const builtAssets = readdirSync(resolve(root, 'dist/web/assets'));
if (!builtAssets.some((name) => name.endsWith('.js')) || !builtAssets.some((name) => name.endsWith('.css'))) {
  throw new Error('Management UI JavaScript or CSS asset is missing.');
}
const packed = JSON.parse(run('npm', ['pack', '--dry-run', '--json']));
const packageInfo = packed[0];
if (!packageInfo) throw new Error('npm pack did not return package metadata.');
const manifest = JSON.parse(run('npm', ['pkg', 'get', 'name', 'version', 'license', 'repository', 'homepage', 'bugs', 'os', 'cpu', 'publishConfig']));
const appRoot = resolve(root, 'dist/native/AppleConnector.app');
const appInfo = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(appRoot, 'Contents', 'Info.plist')]));
if (appInfo.CFBundleIdentifier !== 'com.jachy.apple-connector') throw new Error('AppleConnector.app must use bundle id com.jachy.apple-connector.');
if (appInfo.CFBundleExecutable !== 'apple-connector-helper') throw new Error('AppleConnector.app must execute apple-connector-helper.');
if (typeof appInfo.NSCalendarsFullAccessUsageDescription !== 'string' || typeof appInfo.NSRemindersFullAccessUsageDescription !== 'string') throw new Error('AppleConnector.app must declare Calendar and Reminders usage descriptions.');
if (appInfo.LSUIElement !== true) throw new Error('AppleConnector.app must be a background UI agent (LSUIElement).');
if (appInfo.CFBundleShortVersionString !== manifest.version) throw new Error('AppleConnector.app version must match the package version.');
const signature = spawnSync('codesign', ['-dv', '--verbose=4', appRoot], { cwd: root, encoding: 'utf8' });
const signatureDetails = `${signature.stdout ?? ''}${signature.stderr ?? ''}`;
const requirementResult = spawnSync('codesign', ['-d', '-r-', appRoot], { cwd: root, encoding: 'utf8' });
const requirement = `${requirementResult.stdout ?? ''}${requirementResult.stderr ?? ''}`;
if (process.env.APPLE_CONNECTOR_ALLOW_ADHOC === '1') {
  process.stderr.write('WARNING: skipping AppleConnector.app signature identity checks because APPLE_CONNECTOR_ALLOW_ADHOC=1.\n');
} else {
  if (!/Identifier=com\.jachy\.apple-connector\b/.test(signatureDetails)) throw new Error(`AppleConnector.app has an unexpected identifier:\n${signatureDetails}`);
  if (/Signature=adhoc/.test(signatureDetails)) throw new Error(`AppleConnector.app must not be ad-hoc signed:\n${signatureDetails}`);
  if (!/certificate/i.test(requirement) || /cdhash/i.test(requirement)) throw new Error(`AppleConnector.app designated requirement is not stable:\n${requirement}`);
}
for (const field of ['license', 'repository', 'homepage', 'bugs']) {
  if (!manifest[field] || (typeof manifest[field] === 'object' && Object.keys(manifest[field]).length === 0)) {
    throw new Error(`Release metadata is missing required field: ${field}`);
  }
}
if (manifest.name !== '@jachy/apple-connector' || manifest.version !== '0.17.0') throw new Error('Release package identity must be @jachy/apple-connector@0.17.0.');
const versionPayload = JSON.parse(run(process.execPath, ['dist/src/cli/index.js', 'version', '--json']));
if (!versionPayload.ok || versionPayload.data?.version !== manifest.version || versionPayload.meta?.schemaVersion !== 2) {
  throw new Error('CLI version --json must match the package version and schemaVersion 2.');
}
const helpPayload = JSON.parse(run(process.execPath, ['dist/src/cli/index.js', 'help', '--json']));
if (!helpPayload.ok || typeof helpPayload.data !== 'string' || !helpPayload.data.includes('Usage')) {
  throw new Error('CLI help --json must return help text in the standard envelope.');
}
if (manifest.license !== 'MIT') throw new Error('Release package must declare the MIT license.');
const platformList = (value) => Array.isArray(value) ? value : [value];
if (JSON.stringify(platformList(manifest.os)) !== JSON.stringify(['darwin']) || JSON.stringify(platformList(manifest.cpu)) !== JSON.stringify(['arm64'])) {
  throw new Error('Release package must declare macOS Apple Silicon support only.');
}
if (manifest.publishConfig?.access !== 'public') throw new Error('Release package must explicitly publish with public access.');
const files = new Set(packageInfo.files?.map((file) => file.path));
for (const required of ['LICENSE', 'dist/src/cli/index.js', 'dist/web/index.html', 'dist/native/apple-connector-helper',
  'dist/native/AppleConnector.app/Contents/Info.plist', 'dist/native/AppleConnector.app/Contents/MacOS/apple-connector-helper',
  'scripts/jxa/notes/read.js', 'scripts/jxa/reminders/read.js',
  'scripts/jxa/reminders/write.js', 'scripts/jxa/calendar/read.js', 'skill/SKILL.md', 'docs/README.md', 'docs/README_zh.md',
  'docs/cli.md', 'docs/cli_zh.md', 'docs/skill.md', 'docs/skill_zh.md',
  'docs/signing.md', 'docs/signing_zh.md', 'docs/system-permissions.md', 'docs/system-permissions_zh.md',
  'docs/distribution-decision.md', 'docs/getting-started.md', 'docs/getting-started_zh.md', 'docs/install-for-agent.md', 'docs/install-for-agent_zh.md', 'docs/v0.8-to-v0.9-migration.md', ...Object.values(scriptRegistry).map((entry) => `scripts/jxa/${entry.path}`)]) {
  if (!files.has(required)) throw new Error(`npm package would omit ${required}`);
}
for (const forbidden of ['native/', 'native/.build/', 'dist/tests/']) {
  if ([...files].some((path) => path.startsWith(forbidden))) throw new Error(`npm package must not include ${forbidden}`);
}
if ((packageInfo.files?.length ?? 0) > 160) throw new Error(`npm package contains too many files: ${packageInfo.files.length}`);
if ((packageInfo.size ?? Infinity) > 25 * 1024 * 1024) throw new Error(`npm package tarball is unexpectedly large: ${packageInfo.size} bytes`);
const packageTestDir = mkdtempSync(join(tmpdir(), 'apple-connector-release-'));
try {
  const packedTarball = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', packageTestDir]));
  const tarball = resolve(packageTestDir, packedTarball[0].filename);
  const prefix = join(packageTestDir, 'prefix');
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', prefix, tarball]);
  const installedRoot = join(prefix, 'node_modules', '@jachy', 'apple-connector');
  const payload = JSON.parse(execFileSync(process.execPath, [join(installedRoot, 'dist/src/cli/index.js'), 'skill', 'path', '--json'], { encoding: 'utf8' }));
  const expectedSkillPath = realpathSync(resolve(installedRoot, 'skill'));
  if (!payload.ok || realpathSync(payload.data.path) !== expectedSkillPath || !existsSync(join(payload.data.path, 'SKILL.md'))) {
    throw new Error(`Installed tarball CLI must resolve the package-root skill/SKILL.md (received ${payload.data.path}; expected ${expectedSkillPath}).`);
  }
  const installedApp = join(installedRoot, 'dist/native/AppleConnector.app');
  const installedHelper = join(installedApp, 'Contents/MacOS/apple-connector-helper');
  if (!existsSync(installedHelper)) throw new Error('Installed tarball is missing the AppleConnector.app executable.');
  if ((statSync(installedHelper).mode & 0o111) === 0) throw new Error('Installed AppleConnector.app executable lost its execute bit.');
  const installedInfo = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(installedApp, 'Contents', 'Info.plist')]));
  if (installedInfo.CFBundleIdentifier !== 'com.jachy.apple-connector') throw new Error('Installed AppleConnector.app has the wrong bundle id.');
  const installedSignature = spawnSync('codesign', ['--verify', '--strict', installedApp], { encoding: 'utf8' });
  if (installedSignature.status !== 0) throw new Error(`Installed AppleConnector.app signature is invalid:\n${installedSignature.stdout ?? ''}${installedSignature.stderr ?? ''}`);
} finally {
  rmSync(packageTestDir, { recursive: true, force: true });
}
process.stdout.write(`Release verification passed for ${packageInfo.name} ${packageInfo.version}: ${packageInfo.files.length} files, ${packageInfo.size} bytes.\n`);
