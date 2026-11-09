import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index';
import { readManifest, runtimeExport } from './manifest.js';

const root = new URL('..', import.meta.url);
const manifest = await readManifest(new URL('package.json', root));
const repo = manifest.repository.url.replace(/^git\+/, '');
const project = new URL(repo.replace(/\.git$/, '')).pathname.slice(1);
const indexUrl = `https://raw.githubusercontent.com/${project}/main/dsh-plugin-index.json`;
const raw: unknown = JSON.parse(await readFile(new URL('dsh-plugin-index.json', root), 'utf8'));
const index = parseMarketIndex(raw, indexUrl);
const entry = index.plugins.find(plugin => plugin.name === manifest.name);
assert.ok(entry, 'The index must list this bundle');
for (const version of entry.versions) {
  assert.equal(version.source.type, 'git');
  if (version.source.type === 'git') assert.equal(version.source.url, repo);
  assert.ok(version.engines.dsh, 'Every released version must declare DSH compatibility');
  console.log(`${entry.name}@${version.version}: ${marketInstallTarget(entry.name, version).spec}`);
}
const current = entry.versions.find(version => version.version === manifest.version);
if (current) assert.equal(current.engines.dsh, manifest.engines.dsh);
// 源码可先于索引发布，验证未发布状态时不能移动旧版本 Git pin。
for (const key of ['.', './client', './icon']) await access(new URL(runtimeExport(manifest, key), root));
const host = manifest.exports['.'];
if (typeof host === 'object' && host.types) await access(new URL(host.types, root));
await access(new URL(manifest.dsh.bundle.patch, root));
console.log(`Valid format ${index.format}; ${entry.versions.length} immutable version(s); user-added index: ${indexUrl}`);
