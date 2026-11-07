import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const output = resolve(root, 'runtime', manifest.version);
await mkdir(output, { recursive: true });
for (const name of ['index.js', 'core.js', 'client.js', 'workspace-adapter.js', 'title.js']) {
  await writeFile(resolve(output, name), await readFile(resolve(root, name), 'utf8'));
}
console.log(`Built runtime/${manifest.version}/ (versioned module paths permit a fresh Loader generation)`);
