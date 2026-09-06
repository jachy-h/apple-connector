import { readdir, readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { join } from 'node:path';

async function check(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) count += await check(path);
    else if (entry.name.endsWith('.js')) {
      new Script(await readFile(path, 'utf8'), { filename: path });
      count++;
    }
  }
  return count;
}
console.log(`Syntax checked ${await check('scripts/jxa')} fixed JXA scripts (not native runtime validation).`);
