import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import type { MarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { z } from 'zod';
import { manifestSchema } from './manifest.js';
import { isRecord } from '../src/shared/protocol.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const commit = process.argv[2];
if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error('Pass the full release source commit: npm run index:build -- <40-hex-commit>');
const git = (args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const committedJson = (path: string): unknown => JSON.parse(git(['show', `${commit}:${path}`]));
const manifest = manifestSchema.parse(committedJson('package.json'));
const repo = manifest.repository.url.replace(/^git\+/, '');
const page = repo.replace(/\.git$/, '');
const project = new URL(page).pathname.slice(1);
const indexUrl = `https://raw.githubusercontent.com/${project}/main/dsh-plugin-index.json`;
const indexFile = new URL('../dsh-plugin-index.json', import.meta.url);
let previous: MarketIndex | undefined;
try {
  const raw: unknown = JSON.parse(await readFile(indexFile, 'utf8'));
  parseMarketIndex(raw, indexUrl);
  // 校验后保留原始表示，避免把旧图标相对路径等元数据规范化后重写。
  previous = raw as MarketIndex;
} catch (error) { if (!isRecord(error) || error.code !== 'ENOENT') throw error; }
const oldPlugin = previous?.plugins.find(plugin => plugin.name === manifest.name);
const existingVersion = oldPlugin?.versions.find(entry => entry.version === manifest.version);
if (existingVersion && (existingVersion.source.type !== 'git' || existingVersion.source.commit !== commit)) {
  throw new Error('This published version already pins another commit. Bump the package version.');
}
const locale = z.object({ meta: z.object({ title: z.string(), description: z.string() }) });
const en = locale.parse(committedJson('locale/en.json')).meta;
const zh = locale.parse(committedJson('locale/zh.json')).meta;
const version = {
  version: manifest.version,
  publishTimestamp: existingVersion?.publishTimestamp ?? Number(git(['show', '-s', '--format=%ct', commit])),
  source: { type: 'git', url: repo, commit }, engines: { dsh: manifest.engines.dsh },
};
const plugin = {
  name: manifest.name, title: { en: en.title, zh: zh.title }, description: { en: en.description, zh: zh.description },
  icon: './icon.svg', author: manifest.author, homepage: page, repository: { url: repo },
  metadata: { keywords: [...manifest.keywords, '旁支', '对话', 'sidebar'] },
  versions: [version, ...(oldPlugin?.versions ?? []).filter(entry => entry.version !== manifest.version)],
};
const document = {
  format: 1, title: { en: 'Stxr /side plugin index', zh: 'Stxr /side 插件索引' },
  description: { en: 'Third-party plugins. Add this index yourself to browse and install.', zh: '第三方插件索引；用户需自行添加此源后浏览和安装。' },
  plugins: [plugin, ...(previous?.plugins ?? []).filter(entry => entry.name !== manifest.name)],
};
parseMarketIndex(document, indexUrl);
await writeFile(indexFile, JSON.stringify(document, null, 2) + '\n');
console.log(`Indexed ${manifest.name}@${manifest.version} at ${commit}`);
console.log(indexUrl);
