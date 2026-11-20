import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const hostModules = ['dsh-llm', 'dsh-session', 'dsh-session-title-llm'].map(name => `@deepseek-ai/${name}`);
const usePnpm = process.argv.includes('--pnpm');
const consumer = await mkdtemp(join(tmpdir(), 'dsh-codex-side-install-'));

try {
  // Install the actual release artifact, not the development checkout. Harness
  // supplies peers through its runtime resolver and disables autoInstallPeers.
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer], {
    cwd: root, encoding: 'utf8',
  })) as { filename: string }[];
  assert.equal(packed.length, 1);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    name: 'dsh-profile-install-test', private: true,
    dependencies: { '@local/dsh-codex-side': `file:./${packed[0]!.filename}` },
  }));
  if (usePnpm) {
    await writeFile(join(consumer, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n');
  }
  execFileSync(usePnpm ? 'pnpm' : 'npm', usePnpm
    ? ['install', '--ignore-scripts', '--registry=https://registry.npmjs.org']
    : ['install', '--omit=dev', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'],
  { cwd: consumer, stdio: 'inherit' });

  const installedDir = join(consumer, 'node_modules/@local/dsh-codex-side');
  const manifest = JSON.parse(await readFile(join(installedDir, 'package.json'), 'utf8'));
  await access(join(installedDir, manifest.main));
  await access(join(consumer, 'node_modules/zod/package.json'));
  for (const name of hostModules) {
    await assert.rejects(access(join(consumer, 'node_modules', name, 'package.json')), { code: 'ENOENT' },
      `${name} must not shadow the installed Harness`);
    assert.ok(manifest.peerDependencies?.[name], `${name} must be provided by Harness`);
  }
  console.log(`PASS: ${usePnpm ? 'pnpm hoisted' : 'npm'} production install keeps host modules external`);
} finally {
  await rm(consumer, { recursive: true, force: true });
}
