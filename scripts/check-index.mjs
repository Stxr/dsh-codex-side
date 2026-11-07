import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index';

const root = new URL('..', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const repo = manifest.repository.url.replace(/^git\+/, '');
const project = new URL(repo.replace(/\.git$/, '')).pathname.slice(1);
const indexUrl = `https://raw.githubusercontent.com/${project}/main/dsh-plugin-index.json`;
const raw = JSON.parse(await readFile(new URL('dsh-plugin-index.json', root), 'utf8'));
const index = parseMarketIndex(raw, indexUrl);
const entry = index.plugins.find(plugin => plugin.name === manifest.name);
assert.ok(entry, 'The index must list this bundle');
for (const version of entry.versions) {
  assert.equal(version.source.type, 'git');
  assert.equal(version.source.url, repo);
  assert.ok(version.engines.dsh, 'Every released version must declare DSH compatibility');
  console.log(`${entry.name}@${version.version}: ${marketInstallTarget(entry.name, version).spec}`);
}
const current = entry.versions.find(version => version.version === manifest.version);
if (current) assert.equal(current.engines.dsh, manifest.engines.dsh);
// main may contain an unreleased version while the index still serves the last
// release. Validate that state without moving an already published Git pin.
for (const key of ['.', './client', './icon']) await access(new URL(manifest.exports[key], root));
await access(new URL(manifest.dsh.bundle.patch, root));
console.log(`Valid format ${index.format}; ${entry.versions.length} immutable version(s); user-added index: ${indexUrl}`);
