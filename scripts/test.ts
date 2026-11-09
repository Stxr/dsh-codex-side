import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 测试始终先编译，随后只加载版本化发行产物。
await import('./build.js');
const root = fileURLToPath(new URL('..', import.meta.url));
const tests = (await readdir(new URL('../test', import.meta.url))).filter(name => name.endsWith('.test.js')).sort().map(name => `test/${name}`);
const child = spawn(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
process.exitCode = await new Promise<number>((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
