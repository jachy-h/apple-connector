import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
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
if (statSync(resolve(root, 'dist/web/index.html')).size < 100) throw new Error('Management UI build output is unexpectedly small.');
run(process.execPath, ['dist/src/cli/index.js', '--help']);
run(process.execPath, ['dist/src/cli/index.js', 'version']);
const packed = JSON.parse(run('npm', ['pack', '--dry-run', '--json']));
const files = new Set(packed[0]?.files?.map((file) => file.path));
for (const required of ['dist/src/cli/index.js', 'dist/web/index.html', 'scripts/jxa/notes/read.js', 'scripts/jxa/reminders/read.js']) {
  if (!files.has(required)) throw new Error(`npm package would omit ${required}`);
}
process.stdout.write(`Release verification passed for ${packed[0]?.name ?? 'apple-connector'} ${packed[0]?.version ?? ''}.\n`);
