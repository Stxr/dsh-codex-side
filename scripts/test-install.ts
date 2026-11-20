import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const registry = '--registry=https://registry.npmjs.org';
const packageName = '@local/dsh-codex-side';
const hostModules = ['dsh-llm', 'dsh-session', 'dsh-session-title-llm'].map(name => `@deepseek-ai/${name}`);
const testRoot = await realpath(tmpdir());
const layouts = process.argv.includes('--pnpm') ? ['pnpm', 'harness'] as const : ['npm'] as const;

for (const layout of layouts) {
  const consumer = await mkdtemp(join(testRoot, 'dsh-codex-side-install-'));
  try {
    // Test the release artifact with default peer resolution and with Harness's profile layout.
    const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer], {
      cwd: root, encoding: 'utf8',
    })) as { filename: string }[];
    assert.equal(packed.length, 1);
    const consumerManifest = join(consumer, 'package.json');
    await writeFile(consumerManifest, JSON.stringify({
      name: 'dsh-profile-install-test', private: true,
      dependencies: { [packageName]: `file:./${packed[0]!.filename}` },
    }));
    if (layout === 'harness') {
      await writeFile(join(consumer, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n');
    }
    const installer = layout === 'npm' ? 'npm' : 'pnpm';
    const flags = installer === 'npm' ? ['--omit=dev', '--no-audit', '--no-fund'] : ['--prod'];
    execFileSync(installer, ['install', '--ignore-scripts', registry, ...flags], { cwd: consumer, stdio: 'inherit' });

    const hostEntry = createRequire(consumerManifest).resolve(packageName);
    const fromPlugin = createRequire(await realpath(hostEntry));
    assert.ok(fromPlugin.resolve('zod'));
    const nodeModules = join(consumer, 'node_modules');
    const manifest = JSON.parse(await readFile(join(nodeModules, packageName, 'package.json'), 'utf8'));
    for (const name of hostModules) {
      assert.equal(manifest.peerDependencies?.[name], manifest.engines.dsh);
      assert.equal(manifest.peerDependenciesMeta?.[name]?.optional, true);
      await assert.rejects(access(join(nodeModules, name, 'package.json')), { code: 'ENOENT' },
        `${name} must not shadow the installed Harness`);
      assert.throws(() => fromPlugin.resolve(name), { code: 'MODULE_NOT_FOUND' },
        `${name} must not be installed alongside the plugin`);
    }
    console.log(`PASS: ${layout === 'harness' ? 'pnpm hoisted (Harness profile)' : `default ${installer}`} install keeps Harness peers external`);
  } finally {
    // Only remove the fresh child created by mkdtemp above.
    assert.equal(await realpath(consumer), consumer);
    assert.equal(dirname(consumer), testRoot);
    await rm(consumer, { recursive: true, force: true });
  }
}
