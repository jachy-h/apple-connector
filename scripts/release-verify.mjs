import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const requireFile = (path) => {
  if (!existsSync(resolve(root, path))) throw new Error(`Release artifact is missing: ${path}`);
};

run('npm', ['run', 'check']);
requireFile('dist/src/cli/index.js');
requireFile('dist/web/index.html');
requireFile('dist/native/apple-connector-helper');
requireFile('scripts/jxa/notes/read.js');
requireFile('scripts/jxa/reminders/read.js');
requireFile('scripts/jxa/reminders/write.js');
requireFile('scripts/jxa/calendar/read.js');
if (statSync(resolve(root, 'dist/web/index.html')).size < 100) throw new Error('Management UI build output is unexpectedly small.');
run(process.execPath, ['dist/src/cli/index.js', '--help']);
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
for (const field of ['license', 'repository', 'homepage', 'bugs']) {
  if (!manifest[field] || (typeof manifest[field] === 'object' && Object.keys(manifest[field]).length === 0)) {
    throw new Error(`Release metadata is missing required field: ${field}`);
  }
}
if (manifest.name !== '@jachy/apple-connector' || manifest.version !== '0.8.3') throw new Error('Release package identity must be @jachy/apple-connector@0.8.3.');
const platformList = (value) => Array.isArray(value) ? value : [value];
if (JSON.stringify(platformList(manifest.os)) !== JSON.stringify(['darwin']) || JSON.stringify(platformList(manifest.cpu)) !== JSON.stringify(['arm64'])) {
  throw new Error('Release package must declare macOS Apple Silicon support only.');
}
if (manifest.publishConfig?.access !== 'public') throw new Error('Release package must explicitly publish with public access.');
const files = new Set(packageInfo.files?.map((file) => file.path));
for (const required of ['dist/src/cli/index.js', 'dist/web/index.html', 'dist/native/apple-connector-helper', 'scripts/jxa/notes/read.js', 'scripts/jxa/reminders/read.js',
  'scripts/jxa/reminders/write.js', 'scripts/jxa/calendar/read.js', ...Object.values(scriptRegistry).map((entry) => `scripts/jxa/${entry.path}`)]) {
  if (!files.has(required)) throw new Error(`npm package would omit ${required}`);
}
for (const forbidden of ['native/', 'native/.build/', 'dist/tests/']) {
  if ([...files].some((path) => path.startsWith(forbidden))) throw new Error(`npm package must not include ${forbidden}`);
}
if ((packageInfo.files?.length ?? 0) > 150) throw new Error(`npm package contains too many files: ${packageInfo.files.length}`);
if ((packageInfo.size ?? Infinity) > 25 * 1024 * 1024) throw new Error(`npm package tarball is unexpectedly large: ${packageInfo.size} bytes`);
process.stdout.write(`Release verification passed for ${packageInfo.name} ${packageInfo.version}: ${packageInfo.files.length} files, ${packageInfo.size} bytes.\n`);
