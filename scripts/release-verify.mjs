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
const files = new Set(packed[0]?.files?.map((file) => file.path));
for (const required of ['dist/src/cli/index.js', 'dist/web/index.html', 'scripts/jxa/notes/read.js', 'scripts/jxa/reminders/read.js',
  'scripts/jxa/reminders/write.js', 'scripts/jxa/calendar/read.js', ...Object.values(scriptRegistry).map((entry) => `scripts/jxa/${entry.path}`)]) {
  if (!files.has(required)) throw new Error(`npm package would omit ${required}`);
}
process.stdout.write(`Release verification passed for ${packed[0]?.name ?? 'apple-connector'} ${packed[0]?.version ?? ''}.\n`);
