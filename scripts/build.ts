import { build } from 'esbuild';
import type { BuildOptions } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readManifest, runtimeExport } from './manifest.js';

const rootUrl = new URL('..', import.meta.url);
const root = fileURLToPath(rootUrl);
const manifest = await readManifest(new URL('package.json', rootUrl));
const output = `runtime/${manifest.version}`;
if (runtimeExport(manifest, '.') !== `./${output}/index.js` || runtimeExport(manifest, './client') !== `./${output}/client.js`) {
  throw new Error('Package exports must use the current versioned runtime directory.');
}
const generated = '// Generated from TypeScript by npm run build. Edit src/, not this file.';
const common: BuildOptions = { absWorkingDir: root, bundle: true, charset: 'utf8', minify: false, legalComments: 'inline', logLevel: 'info' };
await build({
  ...common,
  entryPoints: { index: 'src/host/index.ts', core: 'src/host/core.ts', title: 'src/host/title.ts', 'workspace-adapter': 'src/host/workspace-adapter.ts' },
  outdir: output, platform: 'node', format: 'esm', target: 'node24', packages: 'external', banner: { js: generated },
});
// 浏览器运行时仅依赖宿主提供的 React，保留 ModuleLoader 的 factory 协议。
await build({
  ...common, entryPoints: ['src/client/index.tsx'], outfile: `${output}/client.js`,
  platform: 'browser', format: 'cjs', target: 'es2023', external: ['react'], jsx: 'transform',
  banner: { js: `${generated}\nwindow.__ModuleLoader__.load({\n  id: ${JSON.stringify(manifest.name)},\n  factory(require) {\n    const module = { exports: {} };` },
  footer: { js: '    return module.exports;\n  }\n});' },
});
execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)),
  '-p', 'tsconfig.build.json', '--outDir', `${output}/types`], { cwd: root, stdio: 'inherit' });
console.log(`Built ${output}/ (versioned module paths permit a fresh Loader generation)`);
