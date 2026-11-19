import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const registry = '--registry=https://registry.npmjs.org';
const installer = process.argv.includes('--pnpm') ? 'pnpm' : 'npm';
const testRoot = await realpath(tmpdir());
const consumer = await mkdtemp(join(testRoot, 'dsh-codex-side-install-'));
const packageName = '@local/dsh-codex-side';

try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer], {
    cwd: root, encoding: 'utf8',
  })) as { filename: string }[];
  assert.equal(packed.length, 1);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    name: 'codex-side-install-test', private: true,
    dependencies: { [packageName]: `file:./${packed[0]!.filename}` },
  }));

  // Use the installer's default peer behavior, including pnpm's virtual store.
  const flags = installer === 'npm' ? ['--omit=dev', '--no-audit', '--no-fund'] : ['--prod'];
  execFileSync(installer, ['install', '--ignore-scripts', registry, ...flags], { cwd: consumer, stdio: 'inherit' });

  const hostEntry = createRequire(join(consumer, 'package.json')).resolve(packageName);
  const fromPlugin = createRequire(await realpath(hostEntry));
  assert.ok(fromPlugin.resolve('zod'));
  for (const name of ['dsh-llm', 'dsh-session', 'dsh-session-title-llm']) {
    assert.throws(() => fromPlugin.resolve(`@deepseek-ai/${name}/package.json`), { code: 'MODULE_NOT_FOUND' },
      `${name} must be supplied by Harness`);
  }
  console.log(`PASS: default ${installer} installation does not install Harness peers`);
} finally {
  // Only remove the fresh child created by mkdtemp above.
  assert.equal(await realpath(consumer), consumer);
  assert.equal(dirname(consumer), testRoot);
  await rm(consumer, { recursive: true, force: true });
}
