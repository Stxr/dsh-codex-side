import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const entry = manifest.exports['.'];
const host = new URL(typeof entry === 'string' ? entry : entry.default, root);
export const runtimeFile = name => new URL(name, host);
export const importRuntime = name => import(runtimeFile(name).href);
